import { createProjectCodec, type ParseResult, type ProjectBase, type ProjectCodec } from '@boombapbot/contracts';
import { AudioController, type AudioStats, type EngineAssets } from './engine/audio-controller';
import { exportSongMidi, measureSeconds, renderSong, type LoopRender } from './engine/offline';
import { samePattern, sameValues, type EngineSetup, type ExportPlan } from './engine/setup';
import { SnareWasm } from './engine/wasm-engine';
import { encodeWav, type WavBitDepth } from './engine/wav';
import type { Machine, MachineHost, MachineSession } from './machine';
import {
  browserStorage,
  loadDraft,
  saveDraft,
  type KeyValueStorage,
} from './state/draft-storage';
import { downloadBytes, exportBaseName, projectFileName, readProjectFile } from './state/project-io';
import { EditorStore, newProjectId } from './state/store';

/** Written by scripts/prepare-assets.mjs next to the built site. */
export interface AssetManifest {
  /** The drum machine the build is. */
  machine: string;
  engine: { worklet: string; wasm: string };
  /** The faceplate image in this build, if it has one. */
  faceplate: string | null;
}

export interface RuntimeOptions<
  Document extends ProjectBase,
  Transient extends object,
  Session extends MachineSession<Document, Transient>,
> {
  /** Base URL the site is served from, ending in a slash. */
  baseUrl: string;
  machine: Machine<Document, Transient, Session>;
  storage?: KeyValueStorage | null;
}

export interface DebugSnapshot<Document extends ProjectBase = ProjectBase> {
  audioStatus: string;
  sampleRate: number | null;
  stats: AudioStats | null;
  /** Sounds synthesised and sent to the audio thread, and taken by it. */
  soundsSent: number;
  soundsTaken: number;
  project: Document;
}

/**
 * Connects the store to audio, local persistence and the exporters, and
 * hosts the machine. One instance per mounted editor.
 */
export class EditorRuntime<
  Document extends ProjectBase = ProjectBase,
  Transient extends object = object,
  Session extends MachineSession<Document, Transient> = MachineSession<Document, Transient>,
> {
  readonly store: EditorStore<Document, Transient>;
  readonly machine: Machine<Document, Transient, Session>;
  /** The machine at work here. Its own panel talks to it. */
  readonly session: Session;
  private readonly codec: ProjectCodec<Document>;
  private readonly baseUrl: string;
  private readonly storage: KeyValueStorage | null;
  private readonly audio: AudioController;
  private manifest: Promise<AssetManifest> | null = null;
  private wasmBytes: Promise<ArrayBuffer> | null = null;
  private offlineWasm: Promise<SnareWasm> | null = null;
  private synced: EngineSetup | null = null;
  private stats: AudioStats | null = null;
  // One sound per slot may be on its way to the audio thread. A knob that
  // moves again meanwhile marks the slot, and the newest setting follows.
  private readonly soundsInFlight = new Map<number, { stale: boolean }>();
  /** When the step now sounding was reported, for placing a tap. */
  private stepStartedAt = 0;
  private soundsSent = 0;
  private soundsTaken = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(options: RuntimeOptions<Document, Transient, Session>) {
    const { machine } = options;
    this.machine = machine;
    this.codec = createProjectCodec([machine.document]);
    this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;

    const draft = this.storage ? loadDraft(this.storage, machine.document, this.codec) : { status: 'empty' as const };
    this.store = new EditorStore({
      project:
        draft.status === 'restored' ? draft.project : machine.document.create({ id: newProjectId(), now: new Date() }),
      memory: machine.memory,
      transient: machine.transient,
      draftOrigin: draft.status === 'restored' ? 'restored' : draft.status === 'unreadable' ? 'recovered' : 'new',
    });
    if (draft.status === 'restored' && draft.changes.length > 0) {
      this.store.notify(
        'info',
        `Your saved beat came from an earlier version. ${machine.messages.earlierVersion}`,
        draft.changes,
      );
    }
    if (draft.status === 'unreadable') {
      this.store.notify('error', machine.messages.unreadableDraft, draft.errors);
    }

    this.audio = new AudioController({
      onState: (state, error) => this.store.setAudioStatus(state, error),
      onPosition: (step, pattern, playing) => {
        // Ignore a late "stopped" report that crosses a fresh Play.
        if (!this.store.getState().playing) return;
        if (!playing) {
          this.store.setPosition(-1, -1);
          return;
        }
        if (step !== this.store.getState().currentStep) this.stepStartedAt = performance.now();
        this.store.setPosition(step, pattern);
      },
      onStats: (stats) => {
        this.stats = stats;
      },
      onMeasures: (measures) => this.session.measures?.(measures),
      onEnded: () => {
        if (!this.store.getState().playing) return;
        this.store.setPlaying(false);
        this.session.stopped();
      },
      onSound: (slot) => {
        this.soundsTaken += 1;
        const flight = this.soundsInFlight.get(slot);
        this.soundsInFlight.delete(slot);
        if (flight?.stale) void this.sendSound(slot);
      },
    });

    const host: MachineHost<Document, Transient> = {
      store: this.store,
      ensureAudio: () => this.ensureAudio(),
      audioRunning: () => this.audio.isReady && this.audio.status === 'running',
      trigger: (track, accent) => this.audio.trigger(track, accent),
      armFill: (armed) => this.audio.armFill(armed),
      stop: () => this.stop(),
      stepStartedAt: () => this.stepStartedAt,
    };
    this.session = machine.session(host);
  }

  /** Starts watching the store. Call once after construction. */
  attach(): void {
    if (this.unsubscribe) return;
    this.persist(this.store.getState().project);
    let previous = this.store.getState();
    this.unsubscribe = this.store.subscribe(() => {
      const before = previous;
      const next = this.store.getState();
      previous = next;
      this.session.changed?.(before, next);
      if (next.project === before.project) return;
      this.persist(next.project);
      this.syncAudio();
    });
    // Warm the caches so the first Play is quick. Sounds are synthesised once
    // audio starts, when its sample rate is known.
    void this.loadManifest().catch(() => undefined);
    void this.loadOfflineWasm().catch(() => undefined);
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    void this.audio.dispose();
  }

  private persist(project: Document): void {
    if (!this.storage) return;
    const result = saveDraft(this.storage, this.machine.document, project);
    this.store.setDraftSaved(result.ok);
  }

  // ---- Assets -------------------------------------------------------------

  private url(path: string): string {
    return `${this.baseUrl}${path.replace(/^\//, '')}`;
  }

  /** Absolute URL of a file listed in the asset manifest. */
  assetUrl(path: string): string {
    return this.url(path);
  }

  loadManifest(): Promise<AssetManifest> {
    this.manifest ??= fetch(this.url('boombapbot-assets.json'), { cache: 'no-cache' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load the asset manifest (${response.status}).`);
        return (await response.json()) as AssetManifest;
      })
      .catch((error: unknown) => {
        this.manifest = null;
        throw error;
      });
    return this.manifest;
  }

  private loadWasmBytes(): Promise<ArrayBuffer> {
    this.wasmBytes ??= this.loadManifest()
      .then((manifest) => fetchBytes(this.url(manifest.engine.wasm)))
      .catch((error: unknown) => {
        this.wasmBytes = null;
        throw error;
      });
    return this.wasmBytes;
  }

  private async engineAssets(): Promise<EngineAssets> {
    const [manifest, bytes] = await Promise.all([this.loadManifest(), this.loadWasmBytes()]);
    // The worklet takes its own copy; this one stays for offline rendering.
    return { workletUrl: this.url(manifest.engine.worklet), wasmBytes: bytes.slice(0) };
  }

  private loadOfflineWasm(): Promise<SnareWasm> {
    this.offlineWasm ??= this.loadWasmBytes()
      .then((bytes) => SnareWasm.fromBytesAsync(bytes))
      .catch((error: unknown) => {
        this.offlineWasm = null;
        throw error;
      });
    return this.offlineWasm;
  }

  // ---- Audio --------------------------------------------------------------

  /** Starts or resumes audio. Call from a user gesture. */
  async ensureAudio(): Promise<boolean> {
    try {
      const wasReady = this.audio.isReady;
      await this.audio.start(() => this.engineAssets());
      if (!wasReady) {
        this.synced = null;
        this.syncAudio();
      }
      return true;
    } catch (error) {
      this.store.notify('error', `Audio could not start: ${describe(error)}`);
      return false;
    }
  }

  private setup(): EngineSetup {
    return this.machine.setup(this.store.getState().project);
  }

  /** Sends whatever changed in the machine's setup to the engine. */
  private syncAudio(): void {
    if (!this.audio.isReady) return;
    const setup = this.setup();
    const previous = this.synced;
    this.synced = setup;

    if (previous?.tempo !== setup.tempo) this.audio.setTempo(setup.tempo);
    const sameTracks =
      previous?.tracks.length === setup.tracks.length &&
      setup.tracks.every((track, index) => sameValues(track, previous.tracks[index]!));
    if (!sameTracks) this.audio.setTracks(setup.tracks);
    if (!previous || !sameValues(previous.accent, setup.accent) || previous.master !== setup.master) {
      this.audio.setMix(setup.accent.plain, setup.accent.accented, setup.master);
    }
    this.audio.setPatterns(
      setup.patterns.flatMap((pattern, index) => {
        const old = previous?.patterns[index];
        return old && samePattern(old, pattern) ? [] : [{ index, pattern }];
      }),
    );
    if (!previous || !sameValues(previous.panel, setup.panel)) this.audio.setPanel(setup.panel);
    for (const sound of setup.sounds) {
      const old = previous?.sounds.find((candidate) => candidate.sound === sound.sound);
      if (!old || !sameValues(old, sound)) void this.sendSound(sound.sound);
    }
  }

  /**
   * Synthesises the sound of one slot from the machine's settings and sends
   * it to the audio thread. The work happens here, on the main thread, never
   * in the worklet. One sound per slot is on its way at a time; a knob that
   * moves again meanwhile is followed once the worklet has taken the last one.
   */
  private async sendSound(slot: number): Promise<void> {
    const sampleRate = this.audio.sampleRate;
    if (!this.audio.isReady || sampleRate === null) return;
    const flight = this.soundsInFlight.get(slot);
    if (flight) {
      flight.stale = true;
      return;
    }
    this.soundsInFlight.set(slot, { stale: false });
    try {
      const wasm = await this.loadOfflineWasm();
      const sound = this.setup().sounds.find((candidate) => candidate.sound === slot);
      if (!sound) throw new Error(`the machine has no sound in slot ${slot}`);
      this.audio.setSound(slot, wasm.synthesise(sound, sampleRate), 1, sampleRate);
      this.soundsSent += 1;
    } catch (error) {
      this.soundsInFlight.delete(slot);
      this.store.notify('error', describe(error));
    }
  }

  async togglePlay(): Promise<void> {
    if (this.store.getState().playing) {
      this.stop();
      return;
    }
    await this.play();
  }

  /** The power switch. Switching off stops the machine; nothing it remembers is lost. */
  setPower(on: boolean): void {
    if (!on && this.store.getState().playing) this.stop();
    this.store.setPower(on);
  }

  async play(): Promise<void> {
    if (!this.store.getState().power) return;
    if (!(await this.ensureAudio())) return;
    const plan = this.session.start();
    if (!plan) return;
    this.audio.setSong(plan.song, plan.loop);
    this.store.setPlaying(true);
    this.session.started?.();
    this.audio.play();
  }

  stop(): void {
    this.store.setPlaying(false);
    this.audio.stop();
    this.session.stopped();
  }

  // ---- Import and export ---------------------------------------------------

  /** Renders what an export holds, offline, with a separate engine instance. */
  async renderLoop(sampleRate: number): Promise<LoopRender> {
    const wasm = await this.loadOfflineWasm();
    return renderSong(wasm, this.setup(), this.exportPlan(wasm, true), sampleRate);
  }

  /** What an export holds. Throws an error that says why when there is nothing to export. */
  private exportPlan(wasm: SnareWasm, audio: boolean): ExportPlan {
    const plan = this.machine.exportPlan(this.store.getState().project);
    if ('error' in plan) throw new Error(plan.error);
    if (!audio) return plan;
    // Audio is rendered in memory, so a long track is cut at a whole measure.
    const limit = wholeMeasuresWithin(measureSeconds(wasm, this.setup(), plan), MAX_WAV_SECONDS);
    if (limit < plan.rhythms.length) {
      this.store.notify(
        'info',
        `The WAV holds the first ${limit} of ${plan.rhythms.length} measures: about ${MAX_WAV_SECONDS / 60} minutes. The MIDI export holds them all.`,
      );
    }
    return { ...plan, rhythms: plan.rhythms.slice(0, limit) };
  }

  async exportWav(bitDepth: WavBitDepth = 24, sampleRate = 44100): Promise<void> {
    try {
      const render = await this.renderLoop(sampleRate);
      const bytes = encodeWav(render.left, render.right, sampleRate, bitDepth);
      downloadBytes(`${exportBaseName(this.store.getState().project)}.wav`, bytes, 'audio/wav');
    } catch (error) {
      this.store.notify('error', `The WAV export failed: ${describe(error)}`);
    }
  }

  async exportMidi(): Promise<void> {
    try {
      const wasm = await this.loadOfflineWasm();
      const bytes = exportSongMidi(wasm, this.setup(), this.exportPlan(wasm, false));
      downloadBytes(`${exportBaseName(this.store.getState().project)}.mid`, bytes, 'audio/midi');
    } catch (error) {
      this.store.notify('error', `The MIDI export failed: ${describe(error)}`);
    }
  }

  exportProject(): void {
    const { project } = this.store.getState();
    downloadBytes(projectFileName(project), this.codec.serialize(project), 'application/json');
  }

  /** Imports a project file. An invalid file leaves the current beat alone. */
  async importProject(file: Blob, name = 'The file'): Promise<boolean> {
    const result = await readProjectFile(file, this.codec);
    return this.adopt(result, `${name} was not imported.`, (beat) => `Imported “${beat}”.`) !== null;
  }

  /**
   * Puts a beat saved to an account on the machine, by the same road as an
   * imported file: checked first, and one undo step. Returns the project it
   * became, or null when it was not a project and nothing changed.
   */
  loadSavedBeat(saved: unknown): Document | null {
    return this.adopt(
      this.codec.parse(saved),
      'That saved beat could not be read.',
      (beat) => `Loaded “${beat}” from your account.`,
    );
  }

  /** Replaces the project with one read from elsewhere, or says why not. */
  private adopt(result: ParseResult<Document>, refused: string, done: (name: string) => string): Document | null {
    if (!result.ok) {
      this.store.notify('error', `${refused} Your current beat is unchanged.`, result.errors);
      return null;
    }
    this.store.replaceProject(result.project);
    const earlier =
      result.changes.length > 0 ? ` It came from an earlier version. ${this.machine.messages.earlierVersion}` : '';
    this.store.notify(
      'info',
      `${done(result.project.name)} Undo brings back the previous beat.${earlier}`,
      result.changes,
    );
    return result.project;
  }

  // ---- Diagnostics ---------------------------------------------------------

  debug(): DebugSnapshot<Document> {
    const state = this.store.getState();
    return {
      audioStatus: state.audioStatus,
      sampleRate: this.audio.sampleRate,
      stats: this.stats,
      soundsSent: this.soundsSent,
      soundsTaken: this.soundsTaken,
      project: state.project,
    };
  }
}

/** The longest WAV an export renders. */
const MAX_WAV_SECONDS = 300;

/** How many measures fit in a number of seconds, never fewer than one. */
function wholeMeasuresWithin(measures: number[], seconds: number): number {
  let elapsed = 0;
  let count = 0;
  for (const measure of measures) {
    elapsed += measure;
    if (count > 0 && elapsed > seconds) break;
    count += 1;
  }
  return count;
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.arrayBuffer();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

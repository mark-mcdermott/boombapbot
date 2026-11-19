import { createProjectCodec, type ParseResult, type ProjectBase, type ProjectCodec } from '@boombapbot/contracts';
import { AudioController } from './engine/audio-controller';
import { describe, type AudioFactory, type AudioStats, type EngineAssets, type EngineAudio } from './engine/engine-audio';
import { exportSongMidi, measureSeconds, renderSong, type LoopRender } from './engine/offline';
import { renderWav } from './engine/wav-render';
import { NO_EFFECT, samePattern, sameValues, type EngineSetup, type ExportPlan } from './engine/setup';
import { SnareWasm, type SynthSound } from './engine/wasm-engine';
import type { WavBitDepth } from './engine/wav';
import type { Machine, MachineHost, MachineSession, StartPlan } from './machine';
import {
  browserStorage,
  loadDraft,
  saveDraft,
  type KeyValueStorage,
} from './state/draft-storage';
import { downloadFile, exportBaseName, projectFileName, readProjectFile, type SaveFile } from './state/project-io';
import { EditorStore, newProjectId, wavExportUnderWay } from './state/store';

/** Written by scripts/prepare-assets.mjs next to the built site. */
export interface AssetManifest {
  /** The drum machine the build is. */
  machine: string;
  engine: { worklet: string; wasm: string };
  /** The faceplate image in this build, if it has one. */
  faceplate: string | null;
  /** Where the machine's panel art is served from, ending in a slash, if it has any. */
  art?: string;
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
  /** Where an exported file goes. A download when not given. */
  save?: SaveFile;
  /** What plays the engine. The page's own worklet when not given. */
  audio?: AudioFactory;
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
  private readonly save: SaveFile;
  private readonly audio: EngineAudio;
  private manifest: Promise<AssetManifest> | null = null;
  private wasmBytes: Promise<ArrayBuffer> | null = null;
  private offlineWasm: Promise<SnareWasm> | null = null;
  private synced: EngineSetup | null = null;
  private stats: AudioStats | null = null;
  private level = 0;
  // One sound per slot may be on its way to the audio thread. A knob that
  // moves again meanwhile marks the slot, and the newest setting follows.
  private readonly soundsInFlight = new Map<number, { stale: boolean }>();
  /** When the step now sounding was reported, for placing a tap. */
  private stepStartedAt = 0;
  private soundsSent = 0;
  private soundsTaken = 0;
  /** What play asked of the engine besides the setup, while it plays. */
  private playingPlan: StartPlan | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(options: RuntimeOptions<Document, Transient, Session>) {
    const { machine } = options;
    this.machine = machine;
    this.codec = createProjectCodec([machine.document]);
    this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.save = options.save ?? downloadFile;

    const draft = this.storage ? loadDraft(this.storage, machine.document, this.codec) : { status: 'empty' as const };
    this.store = new EditorStore({
      project:
        draft.status !== 'restored'
          ? machine.document.create({ id: newProjectId(), now: new Date() })
          : draft.adopted
            ? asNewBeat(draft.project)
            : draft.project,
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

    const makeAudio: AudioFactory = options.audio ?? ((events) => new AudioController(events));
    this.audio = makeAudio({
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
        this.playingPlan = null;
        this.session.stopped();
      },
      onLevel: (level) => {
        this.level = level;
      },
      onSound: (slot) => {
        this.soundsTaken += 1;
        const flight = this.soundsInFlight.get(slot);
        this.soundsInFlight.delete(slot);
        if (flight?.stale) void this.sendSound(slot);
      },
      onReset: () => this.retell(),
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
    if ('cue' in setup.follow) {
      if (!previous || !('cue' in previous.follow) || previous.follow.cue !== setup.follow.cue) {
        this.audio.cue(setup.follow.cue);
      }
    } else if (!previous || !('panel' in previous.follow) || !sameValues(previous.follow.panel, setup.follow.panel)) {
      this.audio.setPanel(setup.follow.panel);
    }
    const effect = setup.effect ?? NO_EFFECT;
    if (!sameValues(previous?.effect ?? NO_EFFECT, effect)) this.audio.setEffect(effect);
    for (const sound of setup.sounds) {
      const old = previous?.sounds.find((candidate) => candidate.sound === sound.sound);
      if (!old || !sameValues(old, sound)) void this.sendSound(sound.sound);
    }
  }

  /**
   * Tells an engine that was made again everything the last one knew, and
   * to carry on playing if it was. Sounds on their way to the last one will
   * not be acknowledged, so none is waited for.
   */
  private retell(): void {
    this.soundsInFlight.clear();
    this.synced = null;
    this.syncAudio();
    if (!this.playingPlan) return;
    this.audio.setSong(this.playingPlan.song, this.playingPlan.loop);
    this.audio.play();
  }

  /**
   * Sends the sound of one slot, made from the machine's settings, to the
   * engine. One sound per slot is on its way at a time; a knob that moves
   * again meanwhile is followed once the engine has taken the last one.
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
      await this.deliverSound(slot, sampleRate);
      this.soundsSent += 1;
    } catch (error) {
      this.soundsInFlight.delete(slot);
      this.store.notify('error', describe(error));
    }
  }

  /**
   * A native engine makes the sound itself from its knobs. For the worklet
   * it is synthesised here, on the main thread, never on the audio thread,
   * and handed over as samples.
   */
  private async deliverSound(slot: number, sampleRate: number): Promise<void> {
    if (this.audio.synthSound) {
      this.audio.synthSound(this.soundIn(slot));
      return;
    }
    const wasm = await this.loadOfflineWasm();
    this.audio.setSound(slot, wasm.synthesise(this.soundIn(slot), sampleRate), 1, sampleRate);
  }

  private soundIn(slot: number): SynthSound {
    const sound = this.setup().sounds.find((candidate) => candidate.sound === slot);
    if (!sound) throw new Error(`the machine has no sound in slot ${slot}`);
    return sound;
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
    this.playingPlan = plan;
    this.store.setPlaying(true);
    this.session.started?.();
    this.audio.play();
  }

  stop(): void {
    this.store.setPlaying(false);
    this.playingPlan = null;
    this.audio.stop();
    this.session.stopped();
  }

  // ---- Import and export ---------------------------------------------------

  /**
   * Renders what a WAV export holds, here on the main thread, and hands back
   * the samples. For tests and diagnostics: an export renders in a Worker.
   */
  async renderLoop(sampleRate: number): Promise<LoopRender> {
    const wasm = await this.loadOfflineWasm();
    const { project } = this.store.getState();
    return renderSong(wasm, this.machine.setup(project), this.exportPlan(wasm, project, true), sampleRate);
  }

  /** What an export of a project holds. Throws an error that says why when there is nothing to export. */
  private exportPlan(wasm: SnareWasm, project: Document, audio: boolean): ExportPlan {
    const plan = this.machine.exportPlan(project);
    if ('error' in plan) throw new Error(plan.error);
    if (!audio) return plan;
    // Audio is rendered in memory, so a long track is cut at a whole measure.
    if (!('rhythms' in plan)) return plan;
    const limit = wholeMeasuresWithin(measureSeconds(wasm, this.machine.setup(project), plan), MAX_WAV_SECONDS);
    if (limit < plan.rhythms.length) {
      this.store.notify(
        'info',
        `The WAV holds the first ${limit} of ${plan.rhythms.length} measures: about ${MAX_WAV_SECONDS / 60} minutes. The MIDI export holds them all.`,
      );
    }
    return { ...plan, rhythms: plan.rhythms.slice(0, limit) };
  }

  /**
   * Renders the beat as it stands now to a WAV, in a Worker, and saves it.
   * One at a time: asked again while one is under way, it does nothing.
   */
  async exportWav(bitDepth: WavBitDepth = 24, sampleRate = 44100): Promise<void> {
    if (wavExportUnderWay(this.store.getState().wavExport)) return;
    this.store.setWavExport({ state: 'rendering', progress: 0 });
    try {
      const [wasm, engine] = await Promise.all([this.loadOfflineWasm(), this.loadWasmBytes()]);
      const { project } = this.store.getState();
      const bytes = await renderWav(
        {
          // The Worker takes its own copy; this one stays for the next render.
          wasm: engine.slice(0),
          setup: this.machine.setup(project),
          plan: this.exportPlan(wasm, project, true),
          sampleRate,
          bitDepth,
        },
        (progress) => this.store.setWavExport({ state: 'rendering', progress }),
      );
      // Handing it over can take as long as the person does, where they are asked what to do with it.
      this.store.setWavExport({ state: 'saving' });
      const saved = await this.save({ name: `${exportBaseName(project)}.wav`, data: bytes, type: 'audio/wav' });
      this.store.setWavExport(saved ? { state: 'done', at: Date.now() } : null);
    } catch (error) {
      this.store.setWavExport({ state: 'error' });
      this.store.notify('error', `The WAV export failed: ${describe(error)}`);
    }
  }

  async exportMidi(): Promise<void> {
    try {
      const wasm = await this.loadOfflineWasm();
      const { project } = this.store.getState();
      const bytes = exportSongMidi(wasm, this.machine.setup(project), this.exportPlan(wasm, project, false));
      await this.save({ name: `${exportBaseName(project)}.mid`, data: bytes, type: 'audio/midi' });
    } catch (error) {
      this.store.notify('error', `The MIDI export failed: ${describe(error)}`);
    }
  }

  async exportProject(): Promise<void> {
    const { project } = this.store.getState();
    try {
      await this.save({ name: projectFileName(project), data: this.codec.serialize(project), type: 'application/json' });
    } catch (error) {
      this.store.notify('error', `The project export failed: ${describe(error)}`);
    }
  }

  /** Imports a project file. An invalid file leaves the current beat alone. */
  async importProject(file: Blob, name = 'The file'): Promise<boolean> {
    const result = await readProjectFile(file, this.codec);
    return this.adopt(result, `${name} was not imported.`, (beat) => `Imported “${beat}”.`) !== null;
  }

  /**
   * Puts a beat saved to an account on the machine, by the same road as an
   * imported file: checked first, and one undo step. Returns the project it
   * became and whether it was taken over from another machine, or null when
   * it was not a project and nothing changed.
   */
  loadSavedBeat(saved: unknown): { project: Document; adopted: boolean } | null {
    const result = this.codec.parse(saved);
    const adopted = result.ok && result.adopted === true;
    const project = this.adopt(
      result,
      'That saved beat could not be read.',
      (beat) => `Loaded “${beat}” from your account.${adopted ? ' The one in your account is as it was.' : ''}`,
    );
    return project && { project, adopted };
  }

  /** Replaces the project with one read from elsewhere, or says why not. */
  private adopt(result: ParseResult<Document>, refused: string, done: (name: string) => string): Document | null {
    if (!result.ok) {
      this.store.notify('error', `${refused} Your current beat is unchanged.`, result.errors);
      return null;
    }
    const project = result.adopted ? asNewBeat(result.project) : result.project;
    this.store.replaceProject(project);
    const earlier =
      result.changes.length > 0 ? ` It came from an earlier version. ${this.machine.messages.earlierVersion}` : '';
    this.store.notify(
      'info',
      `${done(project.name)} Undo brings back the previous beat.${earlier}`,
      result.changes,
    );
    return project;
  }

  /** How loud the output is now, from 0, for a meter. A plain reading: a panel asks as it draws. */
  outputLevel(): number {
    return this.level;
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

/**
 * A beat taken over from another machine is a new beat. Under the id it came
 * with, saving it to an account would replace the one it was read from.
 */
function asNewBeat<Document extends ProjectBase>(project: Document): Document {
  return { ...project, id: newProjectId() };
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

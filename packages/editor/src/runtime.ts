import {
  ROLES,
  composition,
  compositionCapacity,
  getTrack,
  isInstrumentId,
  isPerformMode,
  isTrackMode,
  rhythmLength,
  stepsPerBeat,
  tappedStep,
  tempoBpm,
  writePart,
  type Project,
  type Role,
  type TrackId,
} from '@boombapbot/contracts';
import { AudioController, type AudioStats, type EngineAssets } from './engine/audio-controller';
import {
  engineMix,
  enginePanel,
  engineTracks,
  exportPlan,
  rhythmPatterns,
  type RenderPlan,
  soundOwner,
  synthSound,
} from './engine/machine';
import { exportSongMidi, renderSong, type LoopRender } from './engine/offline';
import { SnareWasm, type EngineMeasure, type EnginePanel } from './engine/wasm-engine';
import { encodeWav, type WavBitDepth } from './engine/wav';
import {
  browserStorage,
  loadDraft,
  saveDraft,
  type KeyValueStorage,
} from './state/draft-storage';
import {
  downloadBytes,
  exportBaseName,
  projectFileContents,
  projectFileName,
  readProjectFile,
} from './state/project-io';
import { EditorStore, editTarget } from './state/store';

/** Written by scripts/prepare-assets.mjs next to the built site. */
export interface AssetManifest {
  engine: { worklet: string; wasm: string };
  /** The faceplate image in this build, if it has one. */
  faceplate: string | null;
}

export interface RuntimeOptions {
  /** Base URL the site is served from, ending in a slash. */
  baseUrl: string;
  storage?: KeyValueStorage | null;
}

export interface DebugSnapshot {
  audioStatus: string;
  sampleRate: number | null;
  stats: AudioStats | null;
  /** Sounds synthesised and sent to the audio thread, and taken by it. */
  soundsSent: number;
  soundsTaken: number;
  project: Project;
}

/**
 * Connects the store to audio, local persistence and the exporters. One
 * instance per mounted editor.
 */
export class EditorRuntime {
  readonly store: EditorStore;
  private readonly baseUrl: string;
  private readonly storage: KeyValueStorage | null;
  private readonly audio: AudioController;
  private manifest: Promise<AssetManifest> | null = null;
  private wasmBytes: Promise<ArrayBuffer> | null = null;
  private offlineWasm: Promise<SnareWasm> | null = null;
  private synced: Project | null = null;
  private stats: AudioStats | null = null;
  // One sound per slot may be on its way to the audio thread. A knob that
  // moves again meanwhile marks the slot, and the newest setting follows.
  private readonly soundsInFlight = new Map<number, { stale: boolean }>();
  /** When the step now sounding was reported, for placing a tap. */
  private stepStartedAt = 0;
  /**
   * A rhythm track being composed: the track it starts on, and the rhythm of
   * each measure so far. It is stored when the machine stops, as one change.
   * A take on an empty track grows; one on a written track edits it in place.
   */
  private take: { start: number; fresh: boolean; measures: number[] } | null = null;
  /** What the engine was last told about the intro/fill-in. */
  private fillSent = false;
  private soundsSent = 0;
  private soundsTaken = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(options: RuntimeOptions) {
    this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;

    const draft = this.storage ? loadDraft(this.storage) : { status: 'empty' as const };
    this.store = new EditorStore(
      draft.status === 'restored'
        ? { project: draft.project, draftOrigin: 'restored' }
        : { draftOrigin: draft.status === 'unreadable' ? 'recovered' : 'new' },
    );
    if (draft.status === 'restored' && draft.changes.length > 0) {
      this.store.notify('info', `Your saved beat came from an earlier version. ${EARLIER_VERSION_NOTE}`, draft.changes);
    }
    if (draft.status === 'unreadable') {
      this.store.notify(
        'error',
        'Your saved draft could not be read, so the starter rhythms were loaded. The unreadable draft was kept in this browser.',
        draft.errors,
      );
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
      onMeasures: (measures) => {
        // The engine lets an armed intro or fill-in go as it starts to play.
        if (measures.some((measure) => measure.kind !== 'basic')) {
          this.fillSent = false;
          this.store.setFillArmed(false);
        }
        this.record(measures);
      },
      onEnded: () => {
        if (!this.store.getState().playing) return;
        this.store.setPlaying(false);
        this.finishTake();
      },
      onSound: (slot) => {
        this.soundsTaken += 1;
        const flight = this.soundsInFlight.get(slot);
        this.soundsInFlight.delete(slot);
        const role = ROLES[slot];
        if (flight?.stale && role) void this.sendSound(role);
      },
    });
  }

  /** Starts watching the store. Call once after construction. */
  attach(): void {
    if (this.unsubscribe) return;
    this.persist(this.store.getState().project);
    let previous = this.store.getState().project;
    this.unsubscribe = this.store.subscribe(() => {
      const { project, fillArmed } = this.store.getState();
      if (fillArmed !== this.fillSent) this.sendFill(fillArmed);
      if (project === previous) return;
      // A rhythm track is played or composed from its start, so turning the
      // mode selector into or out of those modes stops the machine.
      const from = previous.panel.mode;
      const to = project.panel.mode;
      if (this.store.getState().playing && from !== to && (isTrackMode(from) || isTrackMode(to))) this.stop();
      previous = project;
      this.persist(project);
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

  private persist(project: Project): void {
    if (!this.storage) return;
    const result = saveDraft(this.storage, project);
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

  /** Sends whatever changed in the project to the engine. */
  private syncAudio(): void {
    if (!this.audio.isReady) return;
    const { project } = this.store.getState();
    const previous = this.synced;
    this.synced = project;
    const { sound } = project;
    const before = previous?.sound;

    if (!previous || tempoBpm(previous.tempo) !== tempoBpm(project.tempo)) {
      this.audio.setTempo(tempoBpm(project.tempo));
    }
    if (!before || before.levels !== sound.levels || before.alternates !== sound.alternates) {
      this.audio.setTracks(engineTracks(sound));
    }
    if (!before || before.accent !== sound.accent || before.master !== sound.master) {
      const mix = engineMix(sound);
      this.audio.setMix(mix.plain, mix.accented, mix.master);
    }
    if (!previous || previous.rhythms !== project.rhythms) {
      this.audio.setPatterns(
        project.rhythms.flatMap((rhythm, index) =>
          previous?.rhythms[index] === rhythm ? [] : rhythmPatterns(rhythm, index),
        ),
      );
    }
    if (!previous || !samePanel(enginePanel(previous), enginePanel(project))) {
      this.audio.setPanel(enginePanel(project));
    }
    for (const role of ROLES) {
      const owner = soundOwner(role);
      if (!before || before.knobs[owner] !== sound.knobs[owner]) void this.sendSound(role);
    }
  }

  /**
   * Synthesises one sound from the knobs of its column and sends it to the
   * audio thread. The work happens here, on the main thread, never in the
   * worklet. One sound per slot is on its way at a time; a knob that moves
   * again meanwhile is followed once the worklet has taken the last one.
   */
  private async sendSound(role: Role): Promise<void> {
    const sampleRate = this.audio.sampleRate;
    if (!this.audio.isReady || sampleRate === null) return;
    const flight = this.soundsInFlight.get(role.index);
    if (flight) {
      flight.stale = true;
      return;
    }
    this.soundsInFlight.set(role.index, { stale: false });
    try {
      const wasm = await this.loadOfflineWasm();
      const pcm = wasm.synthesise(synthSound(role, this.store.getState().project.sound), sampleRate);
      this.audio.setSound(role.index, pcm, 1, sampleRate);
      this.soundsSent += 1;
    } catch (error) {
      this.soundsInFlight.delete(role.index);
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
    const { rhythmTracks, panel } = this.store.getState().project;
    const written = isTrackMode(panel.mode) ? composition(rhythmTracks, panel.selector) : [];
    if (panel.mode === 'play' && written.length === 0) {
      this.store.notify(
        'info',
        `Rhythm track ${panel.selector + 1} is empty. To compose it, turn the mode selector to compose and press start.`,
      );
      return;
    }
    this.take =
      panel.mode === 'compose' ? { start: panel.selector, fresh: written.length === 0, measures: [...written] } : null;
    // A written track plays as a song: round and round in play, once through
    // while it is edited. Everything else follows the panel.
    this.audio.setSong(written, panel.mode === 'play');
    this.store.setPlaying(true);
    // A fill-in armed before audio was running is the intro.
    this.sendFill(this.store.getState().fillArmed);
    this.audio.play();
  }

  stop(): void {
    this.store.setPlaying(false);
    this.audio.stop();
    this.finishTake();
  }

  /** Notes the rhythm of each measure the engine began, while composing. */
  private record(measures: EngineMeasure[]): void {
    const take = this.take;
    if (!take) return;
    const capacity = compositionCapacity(take.start);
    for (const measure of measures) {
      // An empty track grows by a measure at a time. A written one keeps its
      // length: the engine says which of its measures this is.
      const index = take.fresh ? measure.ordinal - 1 : measure.position;
      if (index >= 0 && index < capacity) take.measures[index] = measure.pattern >> 1;
    }
    if (take.fresh && take.measures.length >= capacity) this.stop();
  }

  /** Stores what was composed. The measure in which the machine stopped is the last one. */
  private finishTake(): void {
    const take = this.take;
    this.take = null;
    if (take && take.measures.length > 0) this.store.commitComposition(take.start, take.measures);
  }

  private sendFill(armed: boolean): void {
    this.fillSent = armed;
    this.audio.armFill(armed);
  }

  /**
   * TAP. In a play mode it gives the intro/fill-in priority: it plays once,
   * as the intro or after the measure that is running. Pressed again before
   * then, it takes that back.
   *
   * While a rhythm runs in a write mode it writes the selected track on the
   * step that is sounding, or on the next one once that step is more than
   * half over. Stopped, it plays the selected instrument.
   */
  tap(): void {
    const { project, playing, currentStep, currentPattern, fillArmed } = this.store.getState();
    if (isPerformMode(project.panel.mode)) {
      this.store.setFillArmed(!fillArmed);
      return;
    }
    if (writePart(project.panel.mode) === null) return;
    const target = editTarget(project, currentPattern);
    if (!playing || currentStep < 0) {
      void this.audition(target.track);
      return;
    }
    const rhythm = project.rhythms[target.rhythm]!;
    const stepMs = 60_000 / tempoBpm(project.tempo) / stepsPerBeat(rhythm.preScale);
    const step = tappedStep(rhythm, currentStep, (performance.now() - this.stepStartedAt) / stepMs);
    this.store.tapStep(step);
    // A tap on the step already sounding would otherwise be silent until the next measure.
    if (step === currentStep) this.auditionIfRunning(target.track);
  }

  /** Plays one hit of a track. Starts audio if this is the first gesture. */
  async audition(track: TrackId): Promise<void> {
    if (!this.store.getState().power) return;
    if (!isInstrumentId(track) || !(await this.ensureAudio())) return;
    this.audio.trigger(getTrack(track).index, false);
  }

  /** Plays a hit only if audio is already running; never starts it. */
  auditionIfRunning(track: TrackId): void {
    if (isInstrumentId(track) && this.audio.isReady && this.audio.status === 'running') {
      this.audio.trigger(getTrack(track).index, false);
    }
  }

  // ---- Import and export ---------------------------------------------------

  /**
   * Renders what an export holds, offline, with a separate engine instance:
   * the selected rhythm as a loop, or the selected rhythm track once through.
   */
  async renderLoop(sampleRate: number): Promise<LoopRender> {
    const { project } = this.store.getState();
    return renderSong(await this.loadOfflineWasm(), project, this.exportPlan(sampleRate), sampleRate);
  }

  /** What an export holds, or an error that says why there is nothing to export. */
  private exportPlan(sampleRate?: number): RenderPlan {
    const { project } = this.store.getState();
    const plan = exportPlan(project);
    if (plan.rhythms.length === 0) {
      throw new Error(`rhythm track ${project.panel.selector + 1} is empty.`);
    }
    if (sampleRate === undefined) return plan;
    // Audio is rendered in memory, so a long track is cut at a whole measure.
    const limit = wholeMeasuresWithin(project, plan, MAX_WAV_SECONDS);
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
      const { project } = this.store.getState();
      const bytes = exportSongMidi(await this.loadOfflineWasm(), project, this.exportPlan());
      downloadBytes(`${exportBaseName(project)}.mid`, bytes, 'audio/midi');
    } catch (error) {
      this.store.notify('error', `The MIDI export failed: ${describe(error)}`);
    }
  }

  exportProject(): void {
    const { project } = this.store.getState();
    downloadBytes(projectFileName(project), projectFileContents(project), 'application/json');
  }

  /** Imports a project file. An invalid file leaves the current beat alone. */
  async importProject(file: Blob, name = 'The file'): Promise<boolean> {
    const result = await readProjectFile(file);
    if (!result.ok) {
      this.store.notify('error', `${name} was not imported. Your current beat is unchanged.`, result.errors);
      return false;
    }
    this.store.replaceProject(result.project);
    const earlier = result.changes.length > 0 ? ` It came from an earlier version. ${EARLIER_VERSION_NOTE}` : '';
    this.store.notify(
      'info',
      `Imported “${result.project.name}”. Undo brings back the previous beat.${earlier}`,
      result.changes,
    );
    return true;
  }

  // ---- Diagnostics ---------------------------------------------------------

  debug(): DebugSnapshot {
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

const EARLIER_VERSION_NOTE = 'Its pattern is now Basic Rhythm 1.';

/** The longest WAV an export renders. */
const MAX_WAV_SECONDS = 300;

/** How many measures of a plan fit in a number of seconds, never fewer than one. */
function wholeMeasuresWithin(project: Project, plan: RenderPlan, seconds: number): number {
  const beatSeconds = 60 / tempoBpm(project.tempo);
  let elapsed = 0;
  let count = 0;
  for (const rhythm of plan.rhythms) {
    const entry = project.rhythms[rhythm]!;
    elapsed += (rhythmLength(entry) / stepsPerBeat(entry.preScale)) * beatSeconds;
    if (count > 0 && elapsed > seconds) break;
    count += 1;
  }
  return count;
}

function samePanel(a: EnginePanel, b: EnginePanel): boolean {
  return (Object.keys(a) as Array<keyof EnginePanel>).every((key) => a[key] === b[key]);
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.arrayBuffer();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

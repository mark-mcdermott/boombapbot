import {
  KITS,
  OFFERED_KIT_IDS,
  getRole,
  onOfferedKit,
  type KitId,
  type Project,
  type RoleId,
} from '@boombapbot/contracts';
import { AudioController, type AudioStats, type EngineAssets } from './engine/audio-controller';
import { fetchBytes, loadKit, type DecodedKit } from './engine/kit-loader';
import { exportMidi, patternRows, renderLoop, type LoopRender } from './engine/offline';
import { SnareWasm } from './engine/wasm-engine';
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
import { EditorStore } from './state/store';

/** Written by scripts/prepare-assets.mjs next to the built site. */
export interface AssetManifest {
  engine: { worklet: string; wasm: string };
  /** Folder that holds kits/<id>/<file>.wav. */
  kits: string;
  /** Faceplate photos present in this build, by machine. Usually empty. */
  faceplates: Partial<Record<KitId, string>>;
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
  engineKit: string | null;
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
  private readonly kits = new Map<KitId, Promise<DecodedKit>>();
  private manifest: Promise<AssetManifest> | null = null;
  private wasmBytes: Promise<ArrayBuffer> | null = null;
  private offlineWasm: Promise<SnareWasm> | null = null;
  private synced: Project | null = null;
  private engineKit: string | null = null;
  private stats: AudioStats | null = null;
  private unsubscribe: (() => void) | null = null;
  private collectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RuntimeOptions) {
    this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;

    const draft = this.storage ? loadDraft(this.storage) : { status: 'empty' as const };
    this.store = new EditorStore(
      draft.status === 'restored'
        ? { project: onOfferedKit(draft.project), draftOrigin: 'restored' }
        : { draftOrigin: draft.status === 'unreadable' ? 'recovered' : 'new' },
    );
    if (draft.status === 'restored') {
      const moved = movedKitNote(draft.project, this.store.getState().project);
      if (moved) this.store.notify('info', moved);
    }
    if (draft.status === 'unreadable') {
      this.store.notify(
        'error',
        'Your saved draft could not be read, so a starter beat was loaded. The unreadable draft was kept in this browser.',
        draft.errors,
      );
    }

    this.audio = new AudioController({
      onState: (state, error) => this.store.setAudioStatus(state, error),
      onPosition: (step, playing) => {
        // Ignore a late "stopped" report that crosses a fresh Play.
        if (this.store.getState().playing) this.store.setCurrentStep(playing ? step : -1);
      },
      onStats: (stats) => {
        this.stats = stats;
      },
      onKit: (id) => {
        this.engineKit = id;
        if (id === this.store.getState().project.kit.id) this.store.setKitStatus('ready');
      },
    });
  }

  /** Starts watching the store. Call once after construction. */
  attach(): void {
    if (this.unsubscribe) return;
    this.persist(this.store.getState().project);
    let previous = this.store.getState().project;
    this.unsubscribe = this.store.subscribe(() => {
      const { project } = this.store.getState();
      if (project === previous) return;
      previous = project;
      this.persist(project);
      this.syncAudio();
    });
    // Warm the caches so the first Play and the first kit switch are quick.
    void this.loadManifest().catch(() => undefined);
    void this.kit(this.store.getState().project.kit.id).catch(() => undefined);
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.collectTimer) clearTimeout(this.collectTimer);
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

  /** Decoded kit, fetched once and cached for playback and export. */
  kit(id: KitId): Promise<DecodedKit> {
    let cached = this.kits.get(id);
    if (!cached) {
      cached = this.loadManifest()
        .then((manifest) => loadKit(KITS[id], this.url(manifest.kits), fetchBytes))
        .catch((error: unknown) => {
          this.kits.delete(id);
          throw error;
        });
      this.kits.set(id, cached);
    }
    return cached;
  }

  /** Fetches the other offered kits in the background so switching is instant. */
  preloadKits(): void {
    for (const id of OFFERED_KIT_IDS) void this.kit(id).catch(() => undefined);
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
        this.preloadKits();
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

    if (!previous || previous.bpm !== project.bpm) this.audio.setTempo(project.bpm);
    if (!previous || previous.swing !== project.swing) this.audio.setSwing(project.swing);
    if (!previous || previous.pattern !== project.pattern) {
      this.audio.setPattern(patternRows(project));
    }
    if (!previous || previous.kit.id !== project.kit.id) void this.sendKit(project.kit.id);
  }

  private async sendKit(id: KitId): Promise<void> {
    this.store.setKitStatus('loading');
    try {
      const kit = await this.kit(id);
      // The user may have switched again while this kit was loading.
      if (this.store.getState().project.kit.id !== id) return;
      this.audio.setKit(kit);
      // Free the replaced kit once its tails have had time to finish.
      if (this.collectTimer) clearTimeout(this.collectTimer);
      this.collectTimer = setTimeout(() => this.audio.collect(), 4000);
    } catch (error) {
      this.store.setKitStatus('error');
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

  async play(): Promise<void> {
    if (!(await this.ensureAudio())) return;
    this.store.setPlaying(true);
    this.audio.play();
  }

  stop(): void {
    this.store.setPlaying(false);
    this.audio.stop();
  }

  /** Plays one hit of a voice. Starts audio if this is the first gesture. */
  async audition(role: RoleId, velocity = 110): Promise<void> {
    if (!(await this.ensureAudio())) return;
    this.audio.trigger(getRole(role).index, velocity);
  }

  /** Plays a hit only if audio is already running; never starts it. */
  auditionIfRunning(role: RoleId, velocity: number): void {
    if (this.audio.isReady && this.audio.status === 'running') {
      this.audio.trigger(getRole(role).index, velocity);
    }
  }

  // ---- Import and export ---------------------------------------------------

  /** Renders one loop offline with a separate engine instance. */
  async renderLoop(sampleRate: number): Promise<LoopRender> {
    const { project } = this.store.getState();
    const [wasm, kit] = await Promise.all([this.loadOfflineWasm(), this.kit(project.kit.id)]);
    return renderLoop(wasm, project, kit, sampleRate);
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
      const bytes = exportMidi(await this.loadOfflineWasm(), project);
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
    const project = onOfferedKit(result.project);
    this.store.replaceProject(project);
    const moved = movedKitNote(result.project, project);
    this.store.notify(
      'info',
      `Imported “${project.name}”. Undo brings back the previous beat.${moved ? ` ${moved}` : ''}`,
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
      engineKit: this.engineKit,
      project: state.project,
    };
  }
}

/** What to tell the user when a beat had to move off a kit that is held back. */
function movedKitNote(from: Project, to: Project): string | null {
  if (from.kit.id === to.kit.id) return null;
  return `It was made on the ${from.kit.id} kit, which is held back for now, so it plays on the ${to.kit.id}.`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

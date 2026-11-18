import type { ProjectBase } from '@boombapbot/contracts';

export type AudioStatus = 'idle' | 'starting' | 'running' | 'suspended' | 'error';
export type DraftOrigin = 'new' | 'restored' | 'recovered';

export interface Notice {
  id: number;
  kind: 'error' | 'info';
  message: string;
  details?: string[];
}

/**
 * A WAV export: how far its render has come, from 0 to 1, that the rendered
 * file is being handed over, or how the last one ended.
 */
export type WavExport =
  | { state: 'rendering'; progress: number }
  | { state: 'saving' }
  | { state: 'done'; at: number }
  | { state: 'error' };

/** One is on its way: rendering, or rendered and not yet handed over. */
export function wavExportUnderWay(wav: WavExport | null): boolean {
  return wav?.state === 'rendering' || wav?.state === 'saving';
}

export interface EditorState<Document extends ProjectBase = ProjectBase, Transient extends object = object> {
  project: Document;
  /** What the machine holds between gestures and does not save, such as a button held down. */
  transient: Transient;
  /** The power switch. Off, the machine is dark and silent; its memory is kept. */
  power: boolean;
  /** Whether the user asked for playback. */
  playing: boolean;
  /** Step the engine last played within its measure, or -1. */
  currentStep: number;
  /** Pattern the engine is playing, or -1. */
  currentPattern: number;
  audioStatus: AudioStatus;
  audioError: string | null;
  draftOrigin: DraftOrigin;
  draftState: 'saved' | 'error';
  draftSavedAt: number | null;
  notice: Notice | null;
  /** Null until a WAV has been asked for. */
  wavExport: WavExport | null;
  canUndo: boolean;
  canRedo: boolean;
}

interface Snapshot<Document> {
  memory: Partial<Document>;
  /** Set when the step replaced the whole project, as an import does. */
  whole?: Document;
}

type Listener = () => void;

const HISTORY_LIMIT = 100;

export interface StoreOptions<Document extends ProjectBase, Transient extends object> {
  project: Document;
  /** The part of a project the machine remembers, and so what undo brings back. */
  memory: (project: Document) => Partial<Document>;
  /** The transient state a machine starts with, and returns to when switched off. */
  transient: Transient;
  draftOrigin?: DraftOrigin;
  now?: () => Date;
}

/** Holds the project and the editing state. The panel reads and writes this one store. */
export class EditorStore<Document extends ProjectBase = ProjectBase, Transient extends object = object> {
  private state: EditorState<Document, Transient>;
  private readonly listeners = new Set<Listener>();
  private undoStack: Snapshot<Document>[] = [];
  private redoStack: Snapshot<Document>[] = [];
  private noticeId = 0;
  private readonly now: () => Date;
  private readonly memory: (project: Document) => Partial<Document>;
  private readonly restingTransient: Transient;

  constructor(options: StoreOptions<Document, Transient>) {
    this.now = options.now ?? (() => new Date());
    this.memory = options.memory;
    this.restingTransient = options.transient;
    this.state = {
      project: options.project,
      transient: options.transient,
      power: true,
      playing: false,
      currentStep: -1,
      currentPattern: -1,
      audioStatus: 'idle',
      audioError: null,
      draftOrigin: options.draftOrigin ?? 'new',
      draftState: 'saved',
      draftSavedAt: null,
      notice: null,
      wavExport: null,
      canUndo: false,
      canRedo: false,
    };
  }

  getState = (): EditorState<Document, Transient> => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<EditorState<Document, Transient>>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private stamped(project: Document): Document {
    return { ...project, updatedAt: this.now().toISOString() };
  }

  /** Changes a knob, a switch or the name. Not an undo step. */
  adjust(project: Document): void {
    this.set({ project: this.stamped(project) });
  }

  /** Changes what the machine remembers, and records it for undo. */
  commit(project: Document, whole = false): void {
    const previous = this.state.project;
    this.undoStack.push({ memory: this.memory(previous), whole: whole ? previous : undefined });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.set({ project: this.stamped(project), canUndo: true, canRedo: false });
  }

  /** Replaces the whole project, for example after an import. Undoable. */
  replaceProject(project: Document): void {
    this.commit(project, true);
  }

  undo(): void {
    this.step(this.undoStack, this.redoStack);
  }

  redo(): void {
    this.step(this.redoStack, this.undoStack);
  }

  private step(from: Snapshot<Document>[], to: Snapshot<Document>[]): void {
    const entry = from.pop();
    if (!entry) return;
    const current = this.state.project;
    to.push({ memory: this.memory(current), whole: entry.whole ? current : undefined });
    this.set({
      project: entry.whole ?? this.stamped({ ...current, ...entry.memory }),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  setName(name: string): void {
    const value = name.trim().slice(0, 80) || 'Untitled beat';
    if (value === this.state.project.name) return;
    this.adjust({ ...this.state.project, name: value });
  }

  // ---- Editing state --------------------------------------------------------

  setTransient(change: Partial<Transient>): void {
    const transient = { ...this.state.transient, ...change };
    const keys = Object.keys(change) as Array<keyof Transient>;
    if (keys.every((key) => transient[key] === this.state.transient[key])) return;
    this.set({ transient });
  }

  setPower(power: boolean): void {
    if (power === this.state.power) return;
    this.set({ power, transient: this.restingTransient });
  }

  setPlaying(playing: boolean): void {
    if (playing === this.state.playing) return;
    this.set(playing ? { playing } : { playing, currentStep: -1, currentPattern: -1 });
  }

  setPosition(step: number, pattern: number): void {
    if (step === this.state.currentStep && pattern === this.state.currentPattern) return;
    this.set({ currentStep: step, currentPattern: pattern });
  }

  setAudioStatus(audioStatus: AudioStatus, audioError: string | null = null): void {
    if (audioStatus === this.state.audioStatus && audioError === this.state.audioError) return;
    this.set({ audioStatus, audioError });
  }

  setDraftSaved(ok: boolean): void {
    this.set({
      draftState: ok ? 'saved' : 'error',
      draftSavedAt: ok ? this.now().getTime() : this.state.draftSavedAt,
    });
  }

  setWavExport(wavExport: WavExport | null): void {
    this.set({ wavExport });
  }

  notify(kind: Notice['kind'], message: string, details?: string[]): void {
    this.noticeId += 1;
    this.set({ notice: { id: this.noticeId, kind, message, details } });
  }

  dismissNotice(): void {
    if (this.state.notice) this.set({ notice: null });
  }
}

/** An id for a new project. */
export function newProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `beat-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

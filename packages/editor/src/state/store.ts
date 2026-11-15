import {
  PART_STEPS,
  TRACK_IDS,
  clampKnob,
  createEmptyVariation,
  createProject,
  createStarterRhythms,
  isStepOn,
  tempoBpm,
  tempoFromBpm,
  withStep,
  type InstrumentId,
  type Project,
  type Rhythm,
  type SoundParam,
  type TrackId,
  type Variation,
} from '@boombapbot/contracts';
import { selectedVariation } from '../engine/machine';

export type AudioStatus = 'idle' | 'starting' | 'running' | 'suspended' | 'error';
export type DraftOrigin = 'new' | 'restored' | 'recovered';

export interface Notice {
  id: number;
  kind: 'error' | 'info';
  message: string;
  details?: string[];
}

export interface EditorState {
  project: Project;
  /** Whether the user asked for playback. */
  playing: boolean;
  /** Step the engine last played within its measure, or -1. The 2nd part starts at 16. */
  currentStep: number;
  /** Pattern the engine is playing, or -1. */
  currentPattern: number;
  audioStatus: AudioStatus;
  audioError: string | null;
  draftOrigin: DraftOrigin;
  draftState: 'saved' | 'error';
  draftSavedAt: number | null;
  notice: Notice | null;
  canUndo: boolean;
  canRedo: boolean;
}

/** What the machine remembers, and so what undo brings back. */
type Memory = Pick<Project, 'rhythms' | 'rhythmTracks'>;

interface Snapshot {
  memory: Memory;
  /** Set when the step replaced the whole project, as an import does. */
  whole?: Project;
}

/** Where the step buttons write: a version of a rhythm, a track and a part. */
export interface EditTarget {
  rhythm: number;
  variation: Variation;
  track: TrackId;
  /** Step of the first button: 0 in the 1st part, 16 in the 2nd. */
  offset: number;
}

type Listener = () => void;

const HISTORY_LIMIT = 100;

export interface StoreOptions {
  project?: Project;
  draftOrigin?: DraftOrigin;
  now?: () => Date;
  newId?: () => string;
}

function defaultId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `beat-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function memoryOf(project: Project): Memory {
  return { rhythms: project.rhythms, rhythmTracks: project.rhythmTracks };
}

export function editTarget(project: Project): EditTarget {
  const { panel } = project;
  return {
    rhythm: panel.basicRhythm,
    variation: selectedVariation(project),
    track: TRACK_IDS[panel.selector]!,
    offset: panel.mode === 'write_second' ? PART_STEPS : 0,
  };
}

/** Holds the project and the editing state. The panel reads and writes this one store. */
export class EditorStore {
  private state: EditorState;
  private readonly listeners = new Set<Listener>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private noticeId = 0;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: StoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? defaultId;
    this.state = {
      project: options.project ?? this.starterProject(),
      playing: false,
      currentStep: -1,
      currentPattern: -1,
      audioStatus: 'idle',
      audioError: null,
      draftOrigin: options.draftOrigin ?? 'new',
      draftState: 'saved',
      draftSavedAt: null,
      notice: null,
      canUndo: false,
      canRedo: false,
    };
  }

  starterProject(): Project {
    return createProject({ id: this.newId(), now: this.now(), name: 'Starter beat', bpm: 118 });
  }

  getState = (): EditorState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private stamped(project: Project): Project {
    return { ...project, updatedAt: this.now().toISOString() };
  }

  /** Changes a knob, a switch or the name. Not an undo step. */
  private adjust(project: Project): void {
    this.set({ project: this.stamped(project) });
  }

  /** Changes what the machine remembers, and records it for undo. */
  private commit(project: Project, whole = false): void {
    const previous = this.state.project;
    this.undoStack.push({ memory: memoryOf(previous), whole: whole ? previous : undefined });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.set({ project: this.stamped(project), canUndo: true, canRedo: false });
  }

  private commitRhythm(index: number, rhythm: Rhythm): void {
    const { project } = this.state;
    this.commit({ ...project, rhythms: project.rhythms.map((old, i) => (i === index ? rhythm : old)) });
  }

  // ---- Memory edits ---------------------------------------------------------

  /** Presses a step button: toggles that step of the selected track. Returns whether it is now on. */
  toggleStep(button: number): boolean {
    const target = editTarget(this.state.project);
    const step = target.offset + button;
    const row = this.state.project.rhythms[target.rhythm]![target.variation][target.track];
    const on = !isStepOn(row, step);
    this.setStep(target.rhythm, target.variation, target.track, step, on);
    return on;
  }

  setStep(rhythmIndex: number, variation: Variation, track: TrackId, step: number, on: boolean): void {
    const rhythm = this.state.project.rhythms[rhythmIndex];
    if (!rhythm) return;
    const row = rhythm[variation][track];
    const next = withStep(row, step, on);
    if (next === row) return;
    this.commitRhythm(rhythmIndex, { ...rhythm, [variation]: { ...rhythm[variation], [track]: next } });
  }

  /** Wipes the steps of the selected version of the selected rhythm. */
  clearPattern(): void {
    const { rhythm: index, variation } = editTarget(this.state.project);
    const rhythm = this.state.project.rhythms[index]!;
    const empty = createEmptyVariation();
    if (TRACK_IDS.every((id) => rhythm[variation][id] === empty[id])) return;
    this.commitRhythm(index, { ...rhythm, [variation]: empty });
  }

  /** Puts the starter rhythms back in place of everything the machine remembers. */
  loadStarterRhythms(): void {
    const { project } = this.state;
    this.commit({
      ...project,
      rhythms: createStarterRhythms(),
      rhythmTracks: project.rhythmTracks.map(() => []),
    });
  }

  /** Replaces the whole project, for example after an import. Undoable. */
  replaceProject(project: Project): void {
    this.commit(project, true);
  }

  undo(): void {
    this.step(this.undoStack, this.redoStack);
  }

  redo(): void {
    this.step(this.redoStack, this.undoStack);
  }

  private step(from: Snapshot[], to: Snapshot[]): void {
    const entry = from.pop();
    if (!entry) return;
    const current = this.state.project;
    to.push({ memory: memoryOf(current), whole: entry.whole ? current : undefined });
    this.set({
      project: entry.whole ?? this.stamped({ ...current, ...entry.memory }),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  // ---- Knobs and switches ---------------------------------------------------

  /** Sets the tempo in beats per minute: the nearest click stop, then the fine knob. */
  setBpm(bpm: number): void {
    const { project } = this.state;
    const tempo = tempoFromBpm(bpm);
    if (tempoBpm(tempo) === tempoBpm(project.tempo)) return;
    this.adjust({ ...project, tempo });
  }

  /** Turns a tone, decay, tuning or snappy knob. Positions run from 0 to 1. */
  setKnob(track: InstrumentId, param: SoundParam, value: number): void {
    const { project } = this.state;
    const position = clampKnob(value);
    const knobs = project.sound.knobs[track];
    if (position === knobs[param]) return;
    this.adjust({
      ...project,
      sound: { ...project.sound, knobs: { ...project.sound.knobs, [track]: { ...knobs, [param]: position } } },
    });
  }

  /** Turns the instrument selector. */
  selectTrack(track: TrackId): void {
    const { project } = this.state;
    const selector = TRACK_IDS.indexOf(track);
    if (selector === project.panel.selector) return;
    this.adjust({ ...project, panel: { ...project.panel, selector } });
  }

  setName(name: string): void {
    const value = name.trim().slice(0, 80) || 'Untitled beat';
    if (value === this.state.project.name) return;
    this.adjust({ ...this.state.project, name: value });
  }

  // ---- Editing state --------------------------------------------------------

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

  notify(kind: Notice['kind'], message: string, details?: string[]): void {
    this.noticeId += 1;
    this.set({ notice: { id: this.noticeId, kind, message, details } });
  }

  dismissNotice(): void {
    if (this.state.notice) this.set({ notice: null });
  }
}

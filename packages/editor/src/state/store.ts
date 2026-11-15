import {
  BASIC_RHYTHMS,
  PART_STEPS,
  TEMPO_STOPS,
  TRACK_IDS,
  clampKnob,
  clearRhythm,
  clearedVersions,
  createProject,
  createStarterRhythms,
  isPerformMode,
  isStepOn,
  knobPosition,
  panelTarget,
  selectsRhythms,
  withComposition,
  withKnob,
  withPartLength,
  withStep,
  writePart,
  type AutoFill,
  type KnobParam,
  type Mode,
  type PanelState,
  type PreScale,
  type Project,
  type Rhythm,
  type SwitchedId,
  type Tempo,
  type TrackId,
  type Variation,
} from '@boombapbot/contracts';

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
  /** CLEAR is down in a write mode: the next step button sets the part's last step. */
  clearArmed: boolean;
  /** TAP was pressed in a play mode: the intro/fill-in plays next, once. */
  fillArmed: boolean;
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

/** What pressing a step button did. */
export type StepPress = { kind: 'step'; on: boolean } | { kind: 'length' } | { kind: 'rhythm' } | { kind: 'none' };

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

export function editTarget(project: Project, playingPattern = -1): EditTarget {
  const { panel } = project;
  return {
    ...panelTarget(panel, playingPattern),
    track: TRACK_IDS[panel.selector]!,
    offset: writePart(panel.mode) === 1 ? PART_STEPS : 0,
  };
}

function sameRhythm(a: Rhythm, b: Rhythm): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
      clearArmed: false,
      fillArmed: false,
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

  private adjustPanel(change: Partial<PanelState>): void {
    const { project } = this.state;
    const panel = { ...project.panel, ...change };
    if ((Object.keys(change) as Array<keyof PanelState>).every((key) => panel[key] === project.panel[key])) return;
    this.adjust({ ...project, panel });
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
    if (sameRhythm(rhythm, project.rhythms[index]!)) return;
    this.commit({ ...project, rhythms: project.rhythms.map((old, i) => (i === index ? rhythm : old)) });
  }

  // ---- Memory edits ---------------------------------------------------------

  /**
   * Presses a step button. In a write mode it toggles that step of the
   * selected track, or sets the part's last step while CLEAR is down. In
   * pattern clear, manual play and compose it selects a rhythm: 1 to 12 are
   * Basic Rhythms, 13 to 16 Intro/Fill-ins. Playing a rhythm track, the
   * buttons only show what plays.
   */
  pressStep(button: number): StepPress {
    const { project, clearArmed, currentPattern } = this.state;
    const part = writePart(project.panel.mode);
    if (part === null) {
      if (!selectsRhythms(project.panel.mode)) return { kind: 'none' };
      this.selectRhythm(button);
      return { kind: 'rhythm' };
    }
    const target = editTarget(project, currentPattern);
    const rhythm = project.rhythms[target.rhythm]!;
    if (clearArmed) {
      this.set({ clearArmed: false });
      this.commitRhythm(target.rhythm, withPartLength(rhythm, part, button + 1));
      return { kind: 'length' };
    }
    const step = target.offset + button;
    const on = !isStepOn(rhythm[target.variation][target.track], step);
    this.setStep(target.rhythm, target.variation, target.track, step, on);
    return { kind: 'step', on };
  }

  /** Writes the selected track at a step of the rhythm the panel is on, as TAP does. */
  tapStep(step: number): void {
    const target = editTarget(this.state.project, this.state.currentPattern);
    this.setStep(target.rhythm, target.variation, target.track, step, true);
  }

  setStep(rhythmIndex: number, variation: Variation, track: TrackId, step: number, on: boolean): void {
    const rhythm = this.state.project.rhythms[rhythmIndex];
    if (!rhythm) return;
    const row = rhythm[variation][track];
    this.commitRhythm(rhythmIndex, { ...rhythm, [variation]: { ...rhythm[variation], [track]: withStep(row, step, on) } });
  }

  /**
   * Presses CLEAR. In pattern clear it wipes the rhythm the panel is on. In a
   * write mode it stores the pre-scale switch in that rhythm and stays down,
   * so the next step button sets the last step; pressed again, it comes up.
   * In compose it empties the rhythm track the selector is on.
   */
  pressClear(): void {
    const { project, clearArmed } = this.state;
    const { mode } = project.panel;
    if (mode === 'pattern_clear') {
      this.clearRhythm();
    } else if (mode === 'compose') {
      this.commitComposition(project.panel.selector, []);
    } else if (writePart(mode) !== null) {
      const { rhythm: index } = panelTarget(project.panel);
      this.set({ clearArmed: !clearArmed });
      if (!clearArmed) this.commitRhythm(index, { ...project.rhythms[index]!, preScale: project.panel.preScale });
    }
  }

  releaseClear(): void {
    if (this.state.clearArmed) this.set({ clearArmed: false });
  }

  /** Wipes the rhythm the panel is on: both versions when its variation switch is on AB. */
  clearRhythm(): void {
    const { panel, rhythms } = this.state.project;
    const { rhythm: index } = panelTarget(panel);
    this.commitRhythm(index, clearRhythm(rhythms[index]!, clearedVersions(panel)));
  }

  /**
   * Stores a composition from a rhythm track onward: sixty-four measures to a
   * track, going on into the next. One undo step, however long it is.
   */
  commitComposition(start: number, measures: readonly number[]): void {
    const { project } = this.state;
    const rhythmTracks = withComposition(project.rhythmTracks, start, measures);
    if (JSON.stringify(rhythmTracks) === JSON.stringify(project.rhythmTracks)) return;
    this.commit({ ...project, rhythmTracks });
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

  /** Turns the tempo knob to a click stop, the fine knob, or both. */
  setTempo(change: Partial<Tempo>): void {
    const { project } = this.state;
    const coarse = Math.min(TEMPO_STOPS - 1, Math.max(0, Math.round(change.coarse ?? project.tempo.coarse)));
    const fine = Math.min(1, Math.max(-1, change.fine ?? project.tempo.fine));
    if (coarse === project.tempo.coarse && fine === project.tempo.fine) return;
    this.adjust({ ...project, tempo: { coarse, fine } });
  }

  /** Turns a knob of an instrument column, or the accent level. Positions run from 0 to 1. */
  setKnob(track: TrackId, param: KnobParam, value: number): void {
    const { project } = this.state;
    if (knobPosition(project.sound, track, param) === clampKnob(value)) return;
    this.adjust({ ...project, sound: withKnob(project.sound, track, param, value) });
  }

  setMasterVolume(value: number): void {
    const { project } = this.state;
    const master = clampKnob(value);
    if (master === project.sound.master) return;
    this.adjust({ ...project, sound: { ...project.sound, master } });
  }

  /** Throws a voice switch: on selects the column's alternate sound. */
  setAlternate(track: SwitchedId, on: boolean): void {
    const { project } = this.state;
    if (project.sound.alternates[track] === on) return;
    this.adjust({
      ...project,
      sound: { ...project.sound, alternates: { ...project.sound.alternates, [track]: on } },
    });
  }

  /** Turns the mode selector. */
  setMode(mode: Mode): void {
    this.releaseClear();
    // An intro or fill-in waiting to play belongs to the play modes.
    if (!isPerformMode(mode)) this.setFillArmed(false);
    this.adjustPanel({ mode });
  }

  /** Turns the auto fill-in selector: a fill-in every so many measures, or 0 for none. */
  setAutoFill(autoFill: AutoFill): void {
    this.adjustPanel({ autoFill });
  }

  setFillArmed(fillArmed: boolean): void {
    if (fillArmed !== this.state.fillArmed) this.set({ fillArmed });
  }

  /** Selects a rhythm with its step button: the last one pressed is the one the write modes work on. */
  selectRhythm(button: number): void {
    if (button < 0 || button >= PART_STEPS) return;
    this.adjustPanel(
      button < BASIC_RHYTHMS
        ? { basicRhythm: button, writeTarget: 'basic' }
        : { fillRhythm: button, writeTarget: 'fill' },
    );
  }

  /** Moves the pre-scale switch. A rhythm takes it when CLEAR is pressed in a write mode. */
  setPreScale(preScale: PreScale): void {
    this.adjustPanel({ preScale });
  }

  setBasicVariation(basicVariation: PanelState['basicVariation']): void {
    this.adjustPanel({ basicVariation });
  }

  setFillVariation(fillVariation: Variation): void {
    this.adjustPanel({ fillVariation });
  }

  /** Turns the instrument selector. */
  selectTrack(track: TrackId): void {
    this.adjustPanel({ selector: TRACK_IDS.indexOf(track) });
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

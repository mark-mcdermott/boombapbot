import {
  DEFAULT_VELOCITY,
  KITS,
  ROLE_IDS,
  clampBpm,
  clampKnob,
  clampSwing,
  clampVelocity,
  createEmptyPattern,
  createProject,
  createStarterPattern,
  defaultSoundSettings,
  findLane,
  type KitId,
  type Pattern,
  type Project,
  type RoleId,
  type SoundParam,
  type SoundSettings,
} from '@boombapbot/contracts';

export type EditorMode = 'modern' | 'hardware';
export type AudioStatus = 'idle' | 'starting' | 'running' | 'suspended' | 'error';
export type KitStatus = 'idle' | 'loading' | 'ready' | 'error';
export type DraftOrigin = 'new' | 'restored' | 'recovered';

export interface Notice {
  id: number;
  kind: 'error' | 'info';
  message: string;
  details?: string[];
}

export interface EditorState {
  project: Project;
  /** Where the sound knobs stand. Not part of the saved beat yet. */
  sound: SoundSettings;
  mode: EditorMode;
  /** The lane and step the editing controls act on. Shared by both editors. */
  selectedRole: RoleId;
  selectedStep: number;
  /** Whether the user asked for playback. */
  playing: boolean;
  /** Step the engine last played, or -1. */
  currentStep: number;
  audioStatus: AudioStatus;
  audioError: string | null;
  kitStatus: KitStatus;
  draftOrigin: DraftOrigin;
  draftState: 'saved' | 'error';
  draftSavedAt: number | null;
  notice: Notice | null;
  canUndo: boolean;
  canRedo: boolean;
}

type Listener = () => void;

const HISTORY_LIMIT = 100;
/** Continuous gestures (a slider drag) collapse into one undo step. */
const COALESCE_MS = 700;

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

function withPattern(project: Project, pattern: Pattern): Project {
  return { ...project, pattern };
}

function mapLane(
  pattern: Pattern,
  role: RoleId,
  change: (steps: number[]) => number[],
): Pattern {
  return {
    ...pattern,
    lanes: pattern.lanes.map((lane) =>
      lane.role === role ? { ...lane, steps: change(lane.steps.slice()) } : lane,
    ),
  };
}

/**
 * Holds the beat and the editing state. Both editors read and write this one
 * store, so switching between them cannot lose or fork the beat.
 */
export class EditorStore {
  private state: EditorState;
  private readonly listeners = new Set<Listener>();
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private lastChange: { key: string; at: number } | null = null;
  private noticeId = 0;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: StoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? defaultId;
    this.state = {
      project: options.project ?? this.starterProject(),
      sound: defaultSoundSettings(),
      mode: 'hardware',
      selectedRole: 'kick',
      selectedStep: 0,
      playing: false,
      currentStep: -1,
      audioStatus: 'idle',
      audioError: null,
      kitStatus: 'idle',
      draftOrigin: options.draftOrigin ?? 'new',
      draftState: 'saved',
      draftSavedAt: null,
      notice: null,
      canUndo: false,
      canRedo: false,
    };
  }

  starterProject(): Project {
    return createProject({
      id: this.newId(),
      now: this.now(),
      name: 'Starter beat',
      kit: '808',
      bpm: 118,
      swing: 54,
      pattern: createStarterPattern(),
    });
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

  /** Applies a change to the beat and records it for undo. */
  private commit(project: Project, coalesceKey?: string): void {
    if (project === this.state.project) return;
    const at = this.now().getTime();
    const coalesce =
      coalesceKey !== undefined &&
      this.lastChange?.key === coalesceKey &&
      at - this.lastChange.at < COALESCE_MS;
    if (!coalesce) {
      this.undoStack.push(this.state.project);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastChange = coalesceKey !== undefined ? { key: coalesceKey, at } : null;
    this.set({
      project: { ...project, updatedAt: this.now().toISOString() },
      canUndo: this.undoStack.length > 0,
      canRedo: false,
    });
  }

  // ---- Beat edits ---------------------------------------------------------

  /** Turns a step on at the default velocity, or off. Returns the new velocity. */
  toggleStep(role: RoleId, step: number): number {
    const current = findLane(this.state.project.pattern, role).steps[step] ?? 0;
    const next = current > 0 ? 0 : DEFAULT_VELOCITY;
    this.setVelocity(role, step, next);
    return next;
  }

  setVelocity(role: RoleId, step: number, velocity: number, coalesce = false): void {
    const { project } = this.state;
    const value = clampVelocity(velocity);
    if (step < 0 || step >= project.pattern.stepCount) return;
    if (findLane(project.pattern, role).steps[step] === value) return;
    const pattern = mapLane(project.pattern, role, (steps) => {
      steps[step] = value;
      return steps;
    });
    this.commit(withPattern(project, pattern), coalesce ? `velocity:${role}:${step}` : undefined);
  }

  setBpm(bpm: number): void {
    const value = clampBpm(bpm);
    if (value === this.state.project.bpm) return;
    this.commit({ ...this.state.project, bpm: value }, 'bpm');
  }

  setSwing(swing: number): void {
    const value = clampSwing(swing);
    if (value === this.state.project.swing) return;
    this.commit({ ...this.state.project, swing: value }, 'swing');
  }

  /** Changes the kit. Steps, velocities, tempo and swing are untouched. */
  setKit(id: KitId): void {
    if (id === this.state.project.kit.id) return;
    this.commit({ ...this.state.project, kit: { id, version: KITS[id].version } });
  }

  /** Turns a sound knob. Positions run from 0 to 1. */
  setKnob(role: RoleId, param: SoundParam, value: number): void {
    const position = clampKnob(value);
    if (position === this.state.sound[role][param]) return;
    this.set({
      sound: { ...this.state.sound, [role]: { ...this.state.sound[role], [param]: position } },
    });
  }

  setName(name: string): void {
    const value = name.trim().slice(0, 80) || 'Untitled beat';
    if (value === this.state.project.name) return;
    this.commit({ ...this.state.project, name: value }, 'name');
  }

  clearPattern(): void {
    const { project } = this.state;
    const empty = createEmptyPattern();
    // Keep the lane and pattern identity; only the steps are cleared.
    const pattern: Pattern = {
      ...project.pattern,
      lanes: project.pattern.lanes.map((lane) => ({
        ...lane,
        steps: empty.lanes[0]!.steps.slice(),
      })),
    };
    if (project.pattern.lanes.every((lane) => lane.steps.every((velocity) => velocity === 0))) {
      return;
    }
    this.commit(withPattern(project, pattern));
  }

  clearLane(role: RoleId): void {
    const { project } = this.state;
    if (findLane(project.pattern, role).steps.every((velocity) => velocity === 0)) return;
    this.commit(withPattern(project, mapLane(project.pattern, role, (steps) => steps.fill(0))));
  }

  loadStarterBeat(): void {
    const starter = createStarterPattern();
    const { project } = this.state;
    const pattern: Pattern = {
      ...project.pattern,
      lanes: project.pattern.lanes.map((lane) => ({
        ...lane,
        steps: findLane(starter, lane.role).steps.slice(),
      })),
    };
    this.commit(withPattern(project, pattern));
  }

  /** Replaces the whole beat, for example after an import. Undoable. */
  replaceProject(project: Project): void {
    this.commit(project);
    if (!ROLE_IDS.includes(this.state.selectedRole)) this.set({ selectedRole: 'kick' });
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.state.project);
    this.lastChange = null;
    this.set({
      project: previous,
      canUndo: this.undoStack.length > 0,
      canRedo: true,
    });
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.state.project);
    this.lastChange = null;
    this.set({
      project: next,
      canUndo: true,
      canRedo: this.redoStack.length > 0,
    });
  }

  // ---- Editing state ------------------------------------------------------

  select(role: RoleId, step?: number): void {
    const selectedStep = step ?? this.state.selectedStep;
    if (role === this.state.selectedRole && selectedStep === this.state.selectedStep) return;
    this.set({ selectedRole: role, selectedStep });
  }

  setMode(mode: EditorMode): void {
    if (mode !== this.state.mode) this.set({ mode });
  }

  setPlaying(playing: boolean): void {
    if (playing === this.state.playing) return;
    this.set({ playing, currentStep: playing ? this.state.currentStep : -1 });
  }

  setCurrentStep(step: number): void {
    if (step !== this.state.currentStep) this.set({ currentStep: step });
  }

  setAudioStatus(audioStatus: AudioStatus, audioError: string | null = null): void {
    if (audioStatus === this.state.audioStatus && audioError === this.state.audioError) return;
    this.set({ audioStatus, audioError });
  }

  setKitStatus(kitStatus: KitStatus): void {
    if (kitStatus !== this.state.kitStatus) this.set({ kitStatus });
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

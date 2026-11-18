import type { EditorState, EditorStore, MachineHost, MachineSession, StartPlan } from '@boombapbot/editor';
import {
  PATTERN_COUNT,
  STEPS,
  bpmAtKnob,
  clampKnob,
  createEmptyPattern,
  createEmptyPatterns,
  createStarterPatterns,
  isEmptyPattern,
  isStepOn,
  stepsPerBeat,
  voiceTrack,
  withStep,
  type EffectKind,
  type Pattern,
  type Project,
  type Size,
  type VoiceId,
  type VoiceKnob,
  type WriteMode,
} from './document';

/** What РИТМ-12 holds between gestures and does not save. */
export interface TransientRitm12 {
  /** The record lamp is on: while the machine plays, a tapped instrument is written where it fell. */
  recording: boolean;
}

export const RESTING: TransientRitm12 = { recording: false };

export type StoreRitm12 = EditorStore<Project, TransientRitm12>;
export type StateRitm12 = EditorState<Project, TransientRitm12>;

/** What the machine remembers, and so what undo brings back. */
export function memoryOf(project: Project): Pick<Project, 'patterns'> {
  return { patterns: project.patterns };
}

/** Whether any pattern holds anything. */
export function remembersAnything(project: Project): boolean {
  return !project.patterns.every(isEmptyPattern);
}

/** The pattern the step keys show and write. */
export function selectedPattern(project: Project): Pattern {
  return project.patterns[project.panel.pattern]!;
}

/** The row the step keys show: the selected voice's hits, or the pattern's accents. */
export function shownRow(project: Project): string {
  const pattern = selectedPattern(project);
  return project.panel.write === 'accents' ? pattern.accents : pattern.steps[project.panel.selected];
}

/** How likely the dice are to put a hit on a step: likelier on the beat. */
function diceChance(step: number, size: Size): number {
  const beat = stepsPerBeat(size);
  if (step % beat === 0) return 0.55;
  return step % 2 === 0 ? 0.3 : 0.14;
}

/** РИТМ-12 at work in one editor: what its controls do, and how it plays and records. */
export class SessionRitm12 implements MachineSession<Project, TransientRitm12> {
  /** The patterns as they were when a recording began, so the whole take is one undo step. */
  private beforeTake: Pattern[] | null = null;
  /** A tap that fell late in a step is written once the next step has sounded, so it is not heard twice. */
  private waiting: { voice: VoiceId; step: number }[] = [];

  constructor(
    private readonly host: MachineHost<Project, TransientRitm12>,
    private readonly random: () => number = Math.random,
  ) {}

  private get store(): StoreRitm12 {
    return this.host.store;
  }

  private get state(): StateRitm12 {
    return this.store.getState();
  }

  private adjust(change: Partial<Project>): void {
    this.store.adjust({ ...this.state.project, ...change });
  }

  private withPattern(change: (pattern: Pattern) => Pattern): Pattern[] {
    const { project } = this.state;
    return project.patterns.map((pattern, index) => (index === project.panel.pattern ? change(pattern) : pattern));
  }

  private commitPattern(change: (pattern: Pattern) => Pattern): void {
    const { project } = this.state;
    const patterns = this.withPattern(change);
    if (JSON.stringify(patterns) === JSON.stringify(project.patterns)) return;
    this.store.commit({ ...project, patterns });
  }

  // ---- The step keys -----------------------------------------------------------

  /**
   * Presses a step key: a hit of the selected voice, or an accent, goes on or
   * comes off. A key past the end of a twelve-step measure does nothing.
   * Returns whether a hit was put on, for the panel to sound it.
   */
  pressStep(step: number): boolean {
    const { project } = this.state;
    if (step < 0 || step >= project.size) return false;
    const on = !isStepOn(shownRow(project), step);
    if (project.panel.write === 'accents') {
      this.commitPattern((pattern) => ({ ...pattern, accents: withStep(pattern.accents, step, on) }));
      return false;
    }
    const voice = project.panel.selected;
    this.commitPattern((pattern) => ({ ...pattern, steps: { ...pattern.steps, [voice]: withStep(pattern.steps[voice], step, on) } }));
    return on;
  }

  /** Throws the dice: a new row for the selected voice in this pattern, likelier on the beat. One undo step. */
  rollDice(): void {
    const { size, panel } = this.state.project;
    let row = '.'.repeat(STEPS);
    for (let step = 0; step < size; step += 1) {
      if (this.random() < diceChance(step, size)) row = withStep(row, step, true);
    }
    this.commitPattern((pattern) => ({ ...pattern, steps: { ...pattern.steps, [panel.selected]: row } }));
  }

  /** Empties the pattern the panel is on. One undo step. */
  clearPattern(): void {
    this.commitPattern(createEmptyPattern);
  }

  /** Puts the starter patterns back in place of all four. */
  loadStarterPatterns(): void {
    this.store.commit({ ...this.state.project, patterns: createStarterPatterns() });
  }

  /** Empties all four patterns. One undo step. */
  clearEverything(): void {
    const { project } = this.state;
    if (!remembersAnything(project)) return;
    this.store.commit({ ...project, patterns: createEmptyPatterns() });
  }

  // ---- Buttons and switches ----------------------------------------------------

  /**
   * Presses an instrument button: it becomes the one the step keys and the
   * voice knobs work on, and it sounds. While recording a running machine,
   * the hit is also written where it fell.
   */
  pressVoice(voice: VoiceId): void {
    const { project, transient, playing, currentStep, power } = this.state;
    if (!power) return;
    if (project.panel.selected !== voice) this.adjust({ panel: { ...project.panel, selected: voice } });
    if (transient.recording && playing && currentStep >= 0) {
      this.recordTap(voice);
      return;
    }
    void this.audition(voice);
  }

  selectPattern(pattern: number): void {
    const { project } = this.state;
    if (pattern < 0 || pattern >= PATTERN_COUNT || pattern === project.panel.pattern) return;
    this.adjust({ panel: { ...project.panel, pattern } });
  }

  setWriteMode(write: WriteMode): void {
    const { project } = this.state;
    if (write !== project.panel.write) this.adjust({ panel: { ...project.panel, write } });
  }

  setSize(size: Size): void {
    if (size !== this.state.project.size) this.adjust({ size });
  }

  /** Mutes the selected instrument, or lets it sound again. */
  toggleMute(): void {
    const { mix, panel } = this.state.project;
    this.adjust({ mix: { ...mix, mutes: { ...mix.mutes, [panel.selected]: !mix.mutes[panel.selected] } } });
  }

  /** Arms or disarms recording. It takes effect while the machine plays. */
  toggleRecording(): void {
    const recording = !this.state.transient.recording;
    if (!recording) this.finishTake();
    this.store.setTransient({ recording });
  }

  setEffect(kind: EffectKind): void {
    const { effect } = this.state.project;
    if (kind !== effect.kind) this.adjust({ effect: { ...effect, kind } });
  }

  // ---- Knobs, each from 0 to 1 -------------------------------------------------

  setTempoKnob(knob: number): void {
    const tempo = bpmAtKnob(knob);
    if (tempo !== this.state.project.tempo) this.adjust({ tempo });
  }

  setSwing(knob: number): void {
    const swing = clampKnob(knob);
    if (swing !== this.state.project.swing) this.adjust({ swing });
  }

  setAccent(knob: number): void {
    const { mix } = this.state.project;
    const accent = clampKnob(knob);
    if (accent !== mix.accent) this.adjust({ mix: { ...mix, accent } });
  }

  setVolume(knob: number): void {
    const { mix } = this.state.project;
    const volume = clampKnob(knob);
    if (volume !== mix.volume) this.adjust({ mix: { ...mix, volume } });
  }

  setLevel(voice: VoiceId, knob: number): void {
    const { mix } = this.state.project;
    const level = clampKnob(knob);
    if (level !== mix.levels[voice]) this.adjust({ mix: { ...mix, levels: { ...mix.levels, [voice]: level } } });
  }

  /** Turns a knob of the selected voice: its pitch, its decay or its tone. */
  setVoiceKnob(knob: VoiceKnob, value: number): void {
    const { voices, panel } = this.state.project;
    const position = clampKnob(value);
    if (position === voices[panel.selected][knob]) return;
    this.adjust({ voices: { ...voices, [panel.selected]: { ...voices[panel.selected], [knob]: position } } });
  }

  setEffectMix(knob: number): void {
    const { effect } = this.state.project;
    const mix = clampKnob(knob);
    if (mix !== effect.mix) this.adjust({ effect: { ...effect, mix } });
  }

  // ---- Playing and recording ---------------------------------------------------

  /** The machine plays the pattern its panel is on, round and round; a song is not its way. */
  start(): StartPlan {
    return { song: [], loop: false };
  }

  stopped(): void {
    this.finishTake();
  }

  changed(previous: StateRitm12, next: StateRitm12): void {
    if (next.currentStep === previous.currentStep || this.waiting.length === 0) return;
    const due = this.waiting.filter((tap) => tap.step === next.currentStep);
    if (due.length === 0) return;
    this.waiting = this.waiting.filter((tap) => tap.step !== next.currentStep);
    for (const tap of due) this.writeTap(tap.voice, tap.step);
  }

  /** Plays one hit of a voice. Starts audio if this is the first gesture. */
  async audition(voice: VoiceId): Promise<void> {
    if (!this.state.power || !(await this.host.ensureAudio())) return;
    this.host.trigger(voiceTrack(voice), false);
  }

  /** Plays a hit only if audio is already running; never starts it. */
  auditionIfRunning(voice: VoiceId): void {
    if (this.host.audioRunning()) this.host.trigger(voiceTrack(voice), false);
  }

  /**
   * A tap while recording. It is heard at once. In the first half of a step
   * it is written on that step, which has already sounded. In the second
   * half it belongs to the next step, and is written once that step has
   * passed, so the engine does not play it a second time on top of the tap.
   */
  private recordTap(voice: VoiceId): void {
    const { project, currentStep } = this.state;
    this.host.trigger(voiceTrack(voice), false);
    const stepMs = 60_000 / project.tempo / stepsPerBeat(project.size);
    const into = (performance.now() - this.host.stepStartedAt()) / stepMs;
    if (into < 0.5) this.writeTap(voice, currentStep);
    else this.waiting.push({ voice, step: (currentStep + 1) % project.size });
  }

  private writeTap(voice: VoiceId, step: number): void {
    const { project } = this.state;
    this.beforeTake ??= project.patterns;
    const patterns = this.withPattern((pattern) => ({
      ...pattern,
      steps: { ...pattern.steps, [voice]: withStep(pattern.steps[voice], step, true) },
    }));
    // Not an undo step yet: the take is stored as one when it ends.
    this.store.adjust({ ...project, patterns });
  }

  /** Stores what was recorded as one undo step. Taps still waiting for their step are written first. */
  private finishTake(): void {
    for (const tap of this.waiting) this.writeTap(tap.voice, tap.step);
    this.waiting = [];
    const before = this.beforeTake;
    this.beforeTake = null;
    if (!before) return;
    const { project } = this.state;
    if (JSON.stringify(before) === JSON.stringify(project.patterns)) return;
    this.store.adjust({ ...project, patterns: before });
    this.store.commit({ ...project, patterns: project.patterns });
  }
}

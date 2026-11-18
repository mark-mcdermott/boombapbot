import { z } from 'zod';
import machineDocument from '../../data/ritm12.machine.json';

/**
 * РИТМ-12's voices and the arithmetic of its knobs.
 *
 * A voice's place in VOICE_IDS is fixed: it is its sound number in the
 * engine, its sound slot, and one less than its engine track (track 0 holds
 * the accents). Never reorder it.
 */
export const VOICE_IDS = ['kick', 'snare', 'clap', 'closed_hat', 'open_hat', 'tom', 'rim', 'perc'] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

const voiceSchema = z.object({
  id: z.enum(VOICE_IDS),
  /** As it is lettered on the panel. */
  label: z.string().min(1),
  /** What a screen reader calls it. */
  name: z.string().min(1),
  gmNote: z.number().int().min(0).max(127),
  /** Gain at the level knob's resting position. */
  trim: z.number().min(0).max(1),
  pan: z.number().min(-1).max(1),
  /** Voices that share a group other than 0 cut each other off. */
  chokeGroup: z.number().int().min(0),
});

const machineSchema = z.object({
  format: z.literal('boombapbot.machine'),
  schemaVersion: z.literal(1),
  id: z.literal('ritm12'),
  voices: z.array(voiceSchema).length(VOICE_IDS.length),
});

export type Voice = z.infer<typeof voiceSchema> & { index: number };

function loadVoices(): Voice[] {
  const { voices } = machineSchema.parse(machineDocument);
  return voices.map((voice, index) => {
    if (voice.id !== VOICE_IDS[index]) throw new Error(`ritm12.machine.json lists ${voice.id} where ${VOICE_IDS[index]} belongs`);
    return { ...voice, index };
  });
}

export const VOICES: readonly Voice[] = loadVoices();

export function getVoice(id: VoiceId): Voice {
  return VOICES[VOICE_IDS.indexOf(id)]!;
}

/** The engine track a voice plays on. Track 0 is the accents. */
export function voiceTrack(id: VoiceId): number {
  return VOICE_IDS.indexOf(id) + 1;
}

// ---- Patterns ----------------------------------------------------------------

/** Step keys on the panel, and steps in a row. */
export const STEPS = 16;
export const PATTERN_COUNT = 4;
/** Lettered as on the panel. */
export const PATTERN_NAMES = ['А', 'Б', 'В', 'Г'] as const;
/** How many steps a measure plays: sixteenths, or twelve triplet eighths. */
export const SIZES = [16, 12] as const;
export type Size = (typeof SIZES)[number];

/** A row of steps: 'x' on, '.' off. */
export const EMPTY_ROW = '.'.repeat(STEPS);

export function isStepOn(row: string, step: number): boolean {
  return row[step] === 'x';
}

export function withStep(row: string, step: number, on: boolean): string {
  if (step < 0 || step >= STEPS) return row;
  return `${row.slice(0, step)}${on ? 'x' : '.'}${row.slice(step + 1)}`;
}

/** A row as the engine takes it: bit n is step n. */
export function rowMask(row: string): number {
  let mask = 0;
  for (let step = 0; step < STEPS; step += 1) if (isStepOn(row, step)) mask |= 1 << step;
  return mask;
}

/** Steps to the beat for a size: four sixteenths, or three triplet eighths. */
export function stepsPerBeat(size: Size): number {
  return size === 16 ? 4 : 3;
}

// ---- Knobs -------------------------------------------------------------------

export const BPM_MIN = 40;
export const BPM_MAX = 300;

export function clampKnob(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function clampBpm(bpm: number): number {
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm)));
}

/** Where the tempo knob stands for a tempo, 0 to 1. */
export function tempoKnob(bpm: number): number {
  return (clampBpm(bpm) - BPM_MIN) / (BPM_MAX - BPM_MIN);
}

export function bpmAtKnob(knob: number): number {
  return clampBpm(BPM_MIN + clampKnob(knob) * (BPM_MAX - BPM_MIN));
}

/** Where a level knob rests: the voice plays at its trim. */
export const DEFAULT_LEVEL = 0.75;

/** A voice's gain for where its level knob stands. */
export function levelGain(id: VoiceId, level: number): number {
  return getVoice(id).trim * (clampKnob(level) / DEFAULT_LEVEL) ** 2;
}

/**
 * Gains of a plain and an accented hit. The accent knob sets how far apart
 * they are: fully left they are the same, fully right a plain hit is at 40%.
 */
export function accentGains(accent: number): { plain: number; accented: number } {
  return { plain: 1 - 0.6 * clampKnob(accent), accented: 1 };
}

export function masterGain(volume: number): number {
  return clampKnob(volume) ** 1.5;
}

/** The engine's swing for where the swing knob stands. Fully right is the most there is. */
export function engineSwing(swing: number): number {
  return Math.round(clampKnob(swing) * 128);
}

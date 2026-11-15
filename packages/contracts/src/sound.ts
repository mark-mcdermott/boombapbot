import { ROLE_IDS, type RoleId } from './roles';

/** The sound knobs a panel column can have, besides its level. */
export const SOUND_PARAMS = ['tune', 'tone', 'decay', 'snappy'] as const;
export type SoundParam = (typeof SOUND_PARAMS)[number];

/** Knob positions from 0 (fully left) to 1 (fully right). */
export type SoundKnobs = Record<SoundParam, number>;

export const KNOBS_AT_NOON: SoundKnobs = { tune: 0.5, tone: 0.5, decay: 0.5, snappy: 0.5 };

/** What each knob is called on the panel. */
export const SOUND_PARAM_LABELS: Record<SoundParam, string> = {
  tune: 'tuning',
  tone: 'tone',
  decay: 'decay',
  snappy: 'snappy',
};

/** The knobs each voice has. A voice ignores the ones it does not have. */
export const ROLE_KNOBS: Record<RoleId, readonly SoundParam[]> = {
  kick: ['tone', 'decay'],
  snare: ['tone', 'snappy'],
  closed_hat: [],
  open_hat: ['decay'],
  low_tom: ['tune'],
  high_tom: ['tune'],
  clap: [],
  cymbal: ['tone', 'decay'],
};

export type SoundSettings = Record<RoleId, SoundKnobs>;

export function defaultSoundSettings(): SoundSettings {
  return Object.fromEntries(ROLE_IDS.map((role) => [role, { ...KNOBS_AT_NOON }])) as SoundSettings;
}

export function clampKnob(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

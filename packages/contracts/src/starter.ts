import { EMPTY_ROW, RHYTHM_COUNT, TRACK_IDS, withStep, type TrackId } from './machine';
import { createEmptyRhythm, type Rhythm, type RhythmVariation } from './project';

function variation(hits: Partial<Record<TrackId, number[]>>): RhythmVariation {
  const rows = Object.fromEntries(TRACK_IDS.map((id) => [id, EMPTY_ROW])) as RhythmVariation;
  for (const [track, steps] of Object.entries(hits) as Array<[TrackId, number[]]>) {
    for (const step of steps) rows[track] = withStep(rows[track], step, true);
  }
  return rows;
}

/**
 * What a new machine remembers, so the first press of start is audible.
 * Written for boombapbot; these are not the hardware's factory rhythms.
 */
export function createStarterRhythms(): Rhythm[] {
  const rhythms = Array.from({ length: RHYTHM_COUNT }, createEmptyRhythm);
  rhythms[0] = {
    ...createEmptyRhythm(),
    a: variation({
      accent: [0, 8],
      kick: [0, 4, 7, 8, 10, 12],
      snare: [4, 12],
      closed_hat: [0, 2, 4, 6, 8, 10, 12, 13],
      open_hat: [14],
      clap: [12],
      low_tom: [15],
      high_tom: [11],
    }),
  };
  return rhythms;
}

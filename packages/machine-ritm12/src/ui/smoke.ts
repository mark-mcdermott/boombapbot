/**
 * The smoke off a cigarette, as a few thin strands that rise from its lit
 * end, waver more the higher they get, and thin out. Where a strand is at
 * any moment follows from the time alone, so the smoke has nothing to
 * remember and never comes round to where it started.
 */

/** A point of a strand, in the smoke's own box: across from its middle, and up from the lit end. */
export interface SmokePoint {
  across: number;
  up: number;
  /** How wide the strand is here. */
  width: number;
  /** How much of it is left, from 0 to 1. */
  density: number;
}

/** One wave that sways a strand: how far, how fast, how tightly, and where in its swing it starts. */
interface Sway {
  reach: number;
  rate: number;
  curl: number;
  phase: number;
}

interface Strand {
  /** Where on the lit end it leaves, across from the middle. */
  from: number;
  /** How thick it is against the others. */
  weight: number;
  sways: readonly Sway[];
}

/** How high the smoke rises before it is gone, with the box 1 high, and how many seconds a wisp takes to get there. */
export const SMOKE = { height: 1, seconds: 7, samples: 44 } as const;

export const STRANDS: readonly Strand[] = [
  {
    from: -0.004,
    weight: 1,
    sways: [
      { reach: 0.2, rate: 0.47, curl: 5.2, phase: 0.3 },
      { reach: 0.085, rate: 1.13, curl: 11.5, phase: 2.1 },
      { reach: 0.04, rate: 2.31, curl: 19, phase: 4.4 },
    ],
  },
  {
    from: 0.005,
    weight: 0.75,
    sways: [
      { reach: 0.17, rate: 0.41, curl: 4.6, phase: 1.9 },
      { reach: 0.1, rate: 0.97, curl: 9.8, phase: 5.2 },
      { reach: 0.035, rate: 2.63, curl: 21, phase: 0.8 },
    ],
  },
  {
    from: 0,
    weight: 0.55,
    sways: [
      { reach: 0.24, rate: 0.36, curl: 3.9, phase: 3.6 },
      { reach: 0.07, rate: 1.31, curl: 13, phase: 1.2 },
    ],
  },
];

/** How far the top of the smoke is carried across, and which way: towards the machine, away from the picture's edge. */
const LEAN = -0.13;

const smooth = (value: number) => value * value * (3 - 2 * value);

/**
 * Where a strand is a fraction `age` of the way up (0 at the lit end, 1
 * where it is gone), `time` seconds in. It leaves the cigarette straight and
 * steady, and its sway grows with height, each wave travelling up it.
 */
export function strandPoint(strand: Strand, age: number, time: number): SmokePoint {
  const loosened = smooth(Math.min(1, age * 1.6)) * (0.35 + 0.65 * age);
  const swayed = strand.sways.reduce(
    (sum, sway) => sum + sway.reach * Math.sin(sway.rate * time * Math.PI * 2 - sway.curl * age + sway.phase),
    0,
  );
  // A slow draught leans the whole column, more one moment and less the next, always the way it has room to go.
  const draught = age * age * (LEAN + 0.07 * Math.sin(time * 0.21 + 1.3));
  return {
    across: strand.from + loosened * swayed + draught,
    up: SMOKE.height * (1 - (1 - age) ** 1.35),
    width: 0.006 + 0.075 * age ** 1.4,
    density: strand.weight * smooth(Math.min(1, age * 14)) * (1 - age) ** 1.5,
  };
}

/** A strand from its foot to where it is gone, as points close enough together to draw as a line. */
export function strandAt(strand: Strand, time: number): SmokePoint[] {
  return Array.from({ length: SMOKE.samples + 1 }, (_, index) => strandPoint(strand, index / SMOKE.samples, time));
}

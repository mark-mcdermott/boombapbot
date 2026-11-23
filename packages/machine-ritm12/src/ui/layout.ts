import type { EffectKind, VoiceId } from '../document';

/**
 * Where everything sits on the panel picture, in the picture's own pixels.
 * These were measured on the art in ../../art: when a picture changes, run
 * art/cut-art.py and compare what it prints with the boxes and pivots here.
 */
export const PLATE = { width: 2000, height: 1333 } as const;

/** Left, top, right, bottom. */
export type Rect = readonly [number, number, number, number];
/** Across and down from a knob's centre. */
export type Offset = readonly [number, number];
/** A knob's face as it is painted: its centre from the knob's centre, then half its width and height. */
export type Face = readonly [number, number, number, number];

/** The kinds of knob, each with its own pointer line in art/pointer. */
export type KnobKind = 'level' | 'top' | 'voice' | 'mix' | 'volume';

export interface KnobPlace {
  x: number;
  y: number;
  /** Radius of the area that takes a pointer. */
  r: number;
  kind: KnobKind;
  /** Where the pointer line's inner end sits. */
  pivot: Offset;
  /** Given for a knob whose face is oval: the line's tip then follows its edge. */
  face?: Face;
}

export interface InstrumentPlace {
  voice: VoiceId;
  button: Rect;
  /** The end of the key its drawing is printed on, where that drawing's picture is laid over the plate. */
  ink: Rect;
  knob: KnobPlace;
}

const LEVEL_X = 422;
const instrument = (voice: VoiceId, button: Rect, knobY: number, pivot: Offset): InstrumentPlace => ({
  voice,
  button,
  ink: [158, button[1] + 5, 216, button[3] - 5],
  knob: { x: LEVEL_X, y: knobY, r: 30, kind: 'level', pivot },
});

export const INSTRUMENTS: readonly InstrumentPlace[] = [
  instrument('kick', [150, 371, 309, 429], 398, [-4.1, -5]),
  instrument('snare', [150, 450, 309, 507], 476, [-4, -2]),
  instrument('clap', [150, 527, 309, 584], 553, [-4, 1]),
  instrument('closed_hat', [150, 604, 309, 662], 631, [-4, 0]),
  instrument('open_hat', [150, 682, 309, 739], 709, [-4, 0]),
  instrument('tom', [150, 759, 309, 816], 786, [-3.6, 2]),
  instrument('rim', [150, 836, 309, 894], 864, [-3.9, 1]),
  instrument('perc', [150, 918, 310, 977], 946, [-3.9, 0]),
];

/** The lamp beside an instrument button: its centre across, and its radius. Its height is the button's middle. */
export const INSTRUMENT_LAMP = { x: 340, r: 11 } as const;

const STEP_KEY_LEFT = [561, 642, 722, 803, 884, 965, 1046, 1128, 1210, 1293, 1375, 1458, 1540, 1624, 1706, 1789];
export const STEP_KEYS: readonly Rect[] = STEP_KEY_LEFT.map((x) => [x, 954, x + 71, 1024]);

export const PATTERN_KEYS: readonly Rect[] = [
  [1288, 1114, 1363, 1177],
  [1379, 1114, 1454, 1177],
  [1468, 1114, 1542, 1177],
  [1557, 1114, 1632, 1177],
];

export const BUTTONS = {
  power: [178, 1075, 268, 1167],
  play: [403, 1114, 510, 1177],
  stop: [539, 1114, 646, 1177],
  record: [675, 1114, 775, 1177],
  mute: [871, 1149, 942, 1188],
  dice: [1696, 1100, 1773, 1177],
  clear: [1788, 1100, 1869, 1177],
} as const satisfies Record<string, Rect>;

/** The lamp over the machine, which is pressed to switch the room's light off and on. */
export const DESK_LAMP: Rect = [40, 16, 300, 150];

export const POWER_LAMP = { x: 324, y: 1127, r: 15 } as const;

/** The stepped controls, each a round area that is pressed to move it on. */
export const SWITCHES = {
  write: { x: 604, y: 693, r: 37 },
  effect: { x: 1470, y: 756, r: 47 },
  size: { x: 697, y: 827, r: 22 },
} as const;

/** Where each stepped control's other pictures are laid over the plate. */
export const PATCHES = {
  write: [574, 656, 648, 721],
  effect: [1415, 696, 1526, 797],
  size: [674, 804, 727, 846],
  power: [178, 1070, 270, 1186],
} as const satisfies Record<string, Rect>;

/** The picture of the effect selector in each position. The plate itself shows it on chorus. */
export const EFFECT_PATCH: Record<EffectKind, string | null> = {
  delay: 'effect-delay',
  reverb: 'effect-reverb',
  flanger: 'effect-flanger',
  chorus: null,
};

export const KNOBS = {
  tempo: { x: 1545, y: 452, r: 42, kind: 'top', pivot: [0.4, -7], face: [2.7, -4.2, 32.5, 29.4] },
  swing: { x: 1684, y: 452, r: 42, kind: 'top', pivot: [1.1, -7], face: [3.5, -4.1, 32, 29.8] },
  accent: { x: 1820, y: 452, r: 42, kind: 'top', pivot: [3.2, -6], face: [4.8, -4.2, 32.4, 29.2] },
  pitch: { x: 968, y: 780, r: 38, kind: 'voice', pivot: [0, -2] },
  decay: { x: 1136, y: 780, r: 38, kind: 'voice', pivot: [0.6, -2] },
  tone: { x: 1294, y: 780, r: 38, kind: 'voice', pivot: [1.9, -2] },
  mix: { x: 1816, y: 757, r: 36, kind: 'mix', pivot: [2.9, -1], face: [3.2, 1.2, 25.4, 24.8] },
  volume: { x: 1123, y: 1152, r: 36, kind: 'volume', pivot: [0.5, 3] },
} as const satisfies Record<string, KnobPlace>;

/**
 * The phone's panel lays its knobs out itself, each one a round cut of the
 * picture about that knob's own centre, so its pointer line sits on it as on
 * the plate. This is each cut's knob and its radius, as art/cut-phone-parts.py
 * made it. `level` is the kick's level knob, used for whichever voice is selected.
 */
export const PHONE_KNOBS = {
  tempo: { place: KNOBS.tempo, radius: 45 },
  swing: { place: KNOBS.swing, radius: 45 },
  accent: { place: KNOBS.accent, radius: 45 },
  pitch: { place: KNOBS.pitch, radius: 43 },
  decay: { place: KNOBS.decay, radius: 43 },
  tone: { place: KNOBS.tone, radius: 43 },
  mix: { place: KNOBS.mix, radius: 41 },
  volume: { place: KNOBS.volume, radius: 43 },
  level: { place: INSTRUMENTS[0]!.knob, radius: 33 },
} as const satisfies Record<string, { place: KnobPlace; radius: number }>;

/** A pointer line's picture is a square this wide, the line's inner end at its middle, pointing up. */
export const POINTER_SIZE = 88;
/** How long the painted line is, for the kinds whose line is stretched to an oval face. */
export const LINE_LENGTH: Partial<Record<KnobKind, number>> = { top: 27, mix: 22 };
/**
 * How far inside the measured edge of an oval face a line's tip stops. The
 * edge was measured at the middle of the face's bright rim, which the eye
 * reads as outside the face; the rim is widest at the top.
 */
export const TIP_INSET = { top: 1.8, side: 1.4, bottom: 0.4 } as const;
/** A knob turns this many degrees from one end of its travel to the other. */
export const KNOB_SWEEP = 270;

export const SCREEN = { rect: [931, 263, 1398, 536] as Rect, width: 467, height: 273 } as const;

/**
 * The status readout's own box, under the level meter's. The picture was
 * painted without it: `patch` is where the picture of both boxes is laid
 * over the plate, and `box` the readout's, inside its painted line.
 */
export const STATUS = { patch: [505, 278, 870, 580] as Rect, box: [516, 494, 859, 574] as Rect } as const;

export const METER = {
  rect: [602.7, 361, 773.8, 449.4] as Rect,
  /** Where the needle turns, from the meter's left and bottom edges, and how long it is. */
  needle: { left: 85.9, bottom: -17.5, width: 2.2, length: 98.8 },
  /** The painted scale: decibels, and the needle's angle at each. */
  scale: [
    [-20, -45.3],
    [-10, -30.2],
    [-7, -22.2],
    [-5, -14.1],
    [-3, -1.2],
    [-1, 12.7],
    [0, 22.5],
    [3, 45.9],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

/** The needle's angle for a level in decibels, along the painted scale. */
export function meterAngle(decibels: number): number {
  const scale = METER.scale;
  const clamped = Math.min(scale[scale.length - 1]![0], Math.max(scale[0]![0], decibels));
  for (let i = 1; i < scale.length; i += 1) {
    const [fromDb, fromAngle] = scale[i - 1]!;
    const [toDb, toAngle] = scale[i]!;
    if (clamped <= toDb) return fromAngle + ((clamped - fromDb) / (toDb - fromDb)) * (toAngle - fromAngle);
  }
  return scale[scale.length - 1]![1];
}

/**
 * How a knob's pointer line is turned for an angle from straight up. A round
 * knob just turns it. On an oval face the line keeps its inner end where it
 * is painted and is turned and stretched so that its tip rides the face's
 * edge; at the middle of its travel it is exactly as painted.
 */
export function handTransform(degrees: number, place: KnobPlace): string {
  const length = LINE_LENGTH[place.kind];
  if (!place.face || length === undefined) return `rotate(${degrees}deg)`;
  const [cx, faceCy, faceRx, faceRy] = place.face;
  const rx = faceRx - TIP_INSET.side;
  const ry = faceRy - (TIP_INSET.top + TIP_INSET.bottom) / 2;
  const cy = faceCy + (TIP_INSET.top - TIP_INSET.bottom) / 2;
  const angle = (degrees * Math.PI) / 180 + Math.asin((place.pivot[0] - cx) / rx);
  const dx = cx + rx * Math.sin(angle) - place.pivot[0];
  const dy = cy - ry * Math.cos(angle) - place.pivot[1];
  return `rotate(${(Math.atan2(dx, -dy) * 180) / Math.PI}deg) scaleY(${Math.hypot(dx, dy) / length})`;
}

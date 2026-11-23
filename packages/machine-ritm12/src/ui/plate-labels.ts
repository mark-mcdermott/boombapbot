import { LETTERING } from './lettering';
import { INSTRUMENTS, PATTERN_KEYS, type Rect } from './layout';

/**
 * Where the picture is painted on, a label is laid over its Russian. A label
 * on the panel is an engraved plate, dark with cream letters; one on a key
 * or the meter's face is printed dark on cream, as the key or face is.
 */
export interface PlateLabel {
  rect: Rect;
  text: string;
  /** A second, smaller line under the first. */
  under?: string;
  on?: 'key' | 'face';
  /** Letters smaller than a label's usual, in the picture's pixels, where the room is short. */
  size?: number;
}

const english = LETTERING.english;

export const PLATE_LABELS: readonly PlateLabel[] = [
  { rect: [243, 293, 410, 352], text: 'INSTRUMENTS', under: 'DRUM VOICES' },
  ...INSTRUMENTS.map(({ voice, button }): PlateLabel => ({
    rect: [button[0] + 66, button[1] + 9, button[2] - 6, button[3] - 9],
    text: english.voices[voice].key,
    on: 'key',
  })),
  { rect: [612, 296, 731, 327], text: 'LEVEL' },
  { rect: [655, 406, 720, 423], text: 'LEVEL', on: 'face', size: 12 },
  { rect: [1504, 349, 1577, 377], text: english.tempo },
  { rect: [1641, 349, 1719, 377], text: english.swing },
  { rect: [1771, 347, 1866, 395], text: english.accent, under: 'STRENGTH' },
  { rect: [588, 605, 774, 633], text: 'WRITE MODE' },
  { rect: [741, 644, 830, 691], text: english.hits, under: '(NOTES)' },
  { rect: [741, 709, 834, 736], text: english.accents },
  { rect: [581, 778, 694, 806], text: english.size },
  { rect: [764, 784, 846, 807], text: english.straight, size: 14 },
  { rect: [764, 822, 846, 846], text: english.triplets, size: 14 },
  { rect: [966, 621, 1192, 652], text: 'VOICE SHAPING' },
  { rect: [934, 661, 999, 688], text: english.pitch },
  { rect: [1078, 661, 1200, 688], text: english.decay },
  { rect: [1263, 661, 1319, 688], text: english.tone },
  { rect: [1473, 624, 1582, 652], text: english.effect },
  { rect: [1777, 662, 1854, 688], text: english.mix },
  { rect: [590, 884, 744, 912], text: english.sequencer },
  { rect: [411, 1072, 556, 1101], text: 'TRANSPORT' },
  { rect: [877, 1072, 937, 1101], text: english.mute },
  { rect: [1077, 1072, 1210, 1101], text: english.volume },
  { rect: [1294, 1072, 1400, 1101], text: english.pattern },
  ...PATTERN_KEYS.map(([left, top, right, bottom], index): PlateLabel => ({
    rect: [left + 10, top + 10, right - 10, bottom - 10],
    text: `${english.patterns[index]}.`,
    on: 'key',
  })),
  { rect: [1782, 1141, 1864, 1171], text: english.clear, on: 'key' },
  { rect: [192, 1188, 258, 1216], text: english.power },
];

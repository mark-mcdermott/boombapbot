/**
 * A sixteen-segment character, as on a calculator's or a clock's readout
 * that can spell. The outer ring is split in eight; a cross and two
 * diagonals each way run through the middle.
 *
 *    a1  a2
 *  f h i j b
 *    g1  g2
 *  e k l m c
 *    d1  d2
 */
export const SEGMENTS = ['a1', 'a2', 'b', 'c', 'd2', 'd1', 'e', 'f', 'g1', 'g2', 'h', 'i', 'j', 'k', 'l', 'm'] as const;
export type Segment = (typeof SEGMENTS)[number];

const RING = 'a1 a2 b c d1 d2 e f';

const GLYPHS: Record<string, string> = {
  ' ': '',
  '0': `${RING} j k`,
  '1': 'b c j',
  '2': 'a1 a2 b g1 g2 e d1 d2',
  '3': 'a1 a2 b c d1 d2 g2',
  '4': 'f g1 g2 b c',
  '5': 'a1 a2 f g1 m d1 d2',
  '6': 'a1 a2 f e d1 d2 c g1 g2',
  '7': 'a1 a2 b c',
  '8': `${RING} g1 g2`,
  '9': 'a1 a2 b c d1 d2 f g1 g2',
  A: 'a1 a2 b c e f g1 g2',
  B: 'a1 a2 b c d1 d2 i l g2',
  C: 'a1 a2 f e d1 d2',
  D: 'a1 a2 b c d1 d2 i l',
  E: 'a1 a2 f e d1 d2 g1',
  F: 'a1 a2 f e g1',
  G: 'a1 a2 f e d1 d2 c g2',
  H: 'f e b c g1 g2',
  I: 'a1 a2 i l d1 d2',
  J: 'b c d1 d2 e',
  K: 'f e g1 j m',
  L: 'f e d1 d2',
  M: 'f e b c h j',
  N: 'f e b c h m',
  O: RING,
  P: 'a1 a2 b f e g1 g2',
  Q: `${RING} m`,
  R: 'a1 a2 b f e g1 g2 m',
  S: 'a1 a2 f g1 g2 c d1 d2',
  T: 'a1 a2 i l',
  U: 'f e d1 d2 c b',
  V: 'f e k j',
  W: 'f e b c k m',
  X: 'h j k m',
  Y: 'h j l',
  Z: 'a1 a2 j k d1 d2',
  '-': 'g1 g2',
  '+': 'g1 g2 i l',
  '=': 'g1 g2 d1 d2',
  _: 'd1 d2',
  '/': 'j k',
  '\\': 'h m',
  '*': 'g1 g2 h i j k l m',
  '(': 'j m',
  ')': 'h k',
  '<': 'j m',
  '>': 'h k',
  "'": 'i',
  '"': 'i b',
  '?': 'a1 a2 b g2 l',
  '%': 'a1 f g1 i j k l g2 c d2',
  '#': 'b c g1 g2 i l d1 d2 a1 a2',
  '&': 'a1 h i g1 e d1 d2 m',
  '!': 'i',
};

/** Characters a readout draws as another it has. */
const SAME_AS: Record<string, string> = { '−': '-', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '[': '(', ']': ')' };
/** Characters a readout shows as the point after the cell before. */
const POINTS = new Set(['.', ',', ':', ';']);

const LATIN: Record<string, string> = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'ZH', З: 'Z', И: 'I', Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P',
  Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'KH', Ц: 'TS', Ч: 'CH', Ш: 'SH', Щ: 'SHCH', Ъ: '', Ы: 'Y', Ь: '', Э: 'E', Ю: 'YU', Я: 'YA',
};
const CYRILLIC = /[\u0400-\u04ff]/;

/**
 * A line as the readout spells it, in the Latin letters it has. A name's
 * lettering in brackets is left out, as the readout is there to give the
 * English; any other Cyrillic, such as a pattern's letter, is spelled out.
 */
export function readable(text: string): string {
  return text
    .replace(/\s*\([^)]*\)/g, (bracketed) => (CYRILLIC.test(bracketed) ? '' : bracketed))
    .replace(new RegExp(CYRILLIC, 'g'), (letter) => LATIN[letter.toUpperCase()] ?? '');
}

/** One place on the readout: the segments lit, and whether its point is. */
export interface Cell {
  lit: readonly Segment[];
  point: boolean;
}

const BLANK: Cell = { lit: [], point: false };

/** The segments a character lights. One the readout cannot draw lights none. */
export function glyphOf(character: string): readonly Segment[] {
  const upper = character.toUpperCase();
  const pattern = GLYPHS[SAME_AS[upper] ?? upper];
  return pattern ? (pattern.split(' ').filter(Boolean) as Segment[]) : [];
}

/**
 * Text as a row of cells. A full stop, comma or colon lights the point of
 * the character before it, as a readout does, and takes a cell of its own
 * only when that point is already lit or there is nothing before it.
 */
export function cellsOf(text: string): Cell[] {
  const cells: Cell[] = [];
  for (const character of text) {
    const before = cells[cells.length - 1];
    if (POINTS.has(character)) {
      if (before && !before.point) before.point = true;
      else cells.push({ lit: [], point: true });
    } else {
      cells.push({ lit: glyphOf(character), point: false });
    }
  }
  return cells;
}

/** `count` cells of the row starting at `from`, padded with blank ones. */
export function windowOf(cells: readonly Cell[], from: number, count: number): Cell[] {
  return Array.from({ length: count }, (_, index) => cells[from + index] ?? BLANK);
}

/** A cell is drawn in a box this wide and tall, with its point to the right. */
export const CELL = { width: 20, height: 32 } as const;

const THICK = 2.4;
const GAP = 0.55;
const LEFT = 2.5;
const RIGHT = 16;
const TOP = 2;
const MIDDLE = 16;
const BOTTOM = 30;
const CENTRE = (LEFT + RIGHT) / 2;

type Point = readonly [number, number];

const round = (value: number) => Math.round(value * 100) / 100;
const path = (points: readonly Point[]) => `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`;

/** A bar along a line, with its ends pointed so neighbouring bars meet in a mitre. */
function bar(from: Point, to: Point): string {
  const half = THICK / 2;
  const [x1, y1] = from;
  const [x2, y2] = to;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const along: Point = [(x2 - x1) / length, (y2 - y1) / length];
  const across: Point = [-along[1], along[0]];
  const start: Point = [x1 + along[0] * GAP, y1 + along[1] * GAP];
  const end: Point = [x2 - along[0] * GAP, y2 - along[1] * GAP];
  const inset = (point: Point, toward: 1 | -1, side: 1 | -1): Point => [
    point[0] + along[0] * half * toward + across[0] * half * side,
    point[1] + along[1] * half * toward + across[1] * half * side,
  ];
  return path([start, inset(start, 1, 1), inset(end, -1, 1), end, inset(end, -1, -1), inset(start, 1, -1)]);
}

/** A diagonal stops short of the ring and of the cross, so it does not run into either. */
function diagonal(corner: Point): string {
  const shrink = (from: Point, to: Point, by: number): Point => [from[0] + (to[0] - from[0]) * by, from[1] + (to[1] - from[1]) * by];
  const centre: Point = [CENTRE, MIDDLE];
  return bar(shrink(corner, centre, 0.2), shrink(centre, corner, 0.18));
}

/** The outline of each segment, in a cell's own units. */
export const SEGMENT_PATHS: Record<Segment, string> = {
  a1: bar([LEFT, TOP], [CENTRE, TOP]),
  a2: bar([CENTRE, TOP], [RIGHT, TOP]),
  b: bar([RIGHT, TOP], [RIGHT, MIDDLE]),
  c: bar([RIGHT, MIDDLE], [RIGHT, BOTTOM]),
  d2: bar([CENTRE, BOTTOM], [RIGHT, BOTTOM]),
  d1: bar([LEFT, BOTTOM], [CENTRE, BOTTOM]),
  e: bar([LEFT, MIDDLE], [LEFT, BOTTOM]),
  f: bar([LEFT, TOP], [LEFT, MIDDLE]),
  g1: bar([LEFT, MIDDLE], [CENTRE, MIDDLE]),
  g2: bar([CENTRE, MIDDLE], [RIGHT, MIDDLE]),
  h: diagonal([LEFT, TOP]),
  i: bar([CENTRE, TOP], [CENTRE, MIDDLE]),
  j: diagonal([RIGHT, TOP]),
  k: diagonal([LEFT, BOTTOM]),
  l: bar([CENTRE, MIDDLE], [CENTRE, BOTTOM]),
  m: diagonal([RIGHT, BOTTOM]),
};

/** The point, a small square low to the right of the character. */
export const POINT = { x: RIGHT + 1.4, y: BOTTOM - THICK / 2, size: THICK } as const;

/** Every segment of a cell, as one outline: what shows faintly when nothing is lit. */
export const ALL_SEGMENTS = SEGMENTS.map((segment) => SEGMENT_PATHS[segment]).join('');

/** The segments of a cell that are lit, as one outline. */
export const litPath = (cell: Cell) => cell.lit.map((segment) => SEGMENT_PATHS[segment]).join('');

import { describe, expect, it } from 'vitest';
import { PLATE, type Rect } from '../src/ui/layout';
import { LETTERING } from '../src/ui/lettering';
import { PLATE_LABELS } from '../src/ui/plate-labels';
import { SEGMENTS, SEGMENT_PATHS, cellsOf, glyphOf, readable, windowOf } from '../src/ui/segments';

describe('the sixteen-segment readout', () => {
  it('draws every letter and digit, in either case', () => {
    for (const character of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
      expect(glyphOf(character).length, character).toBeGreaterThan(0);
      expect(glyphOf(character.toLowerCase())).toEqual(glyphOf(character));
    }
  });

  it('tells apart the letters that share most segments', () => {
    const drawn = (character: string) => [...glyphOf(character)].sort().join(' ');
    for (const [one, other] of [['O', '0'], ['B', '8'], ['S', '5'], ['I', '1'], ['Z', '2'], ['D', 'O']]) {
      expect(drawn(one!), `${one} and ${other}`).not.toBe(drawn(other!));
    }
  });

  it('lights nothing for a character it cannot draw', () => {
    expect(glyphOf('€')).toEqual([]);
    expect(glyphOf(' ')).toEqual([]);
  });

  it('has an outline for every segment', () => {
    for (const segment of SEGMENTS) expect(SEGMENT_PATHS[segment]).toMatch(/^M[\d. L-]+Z$/);
  });

  it('puts a full stop or colon on the point of the character before it', () => {
    const cells = cellsOf('A.B:');
    expect(cells).toHaveLength(2);
    expect(cells.map((cell) => cell.point)).toEqual([true, true]);
  });

  it('gives a point a cell of its own when there is nothing to hang it on', () => {
    expect(cellsOf('...').map((cell) => cell.point)).toEqual([true, true, true]);
  });

  it('shows a window of the line, padded with blanks', () => {
    const cells = cellsOf('KICK');
    const shown = windowOf(cells, 2, 4);
    expect(shown[0]!.lit).toEqual(glyphOf('C'));
    expect(shown[2]!.lit).toEqual([]);
    expect(shown).toHaveLength(4);
  });

  it('leaves out a name’s Russian lettering in brackets and spells out other Cyrillic', () => {
    expect(readable('Power (СЕТЬ)')).toBe('Power');
    expect(readable('Kick (БАС)')).toBe('Kick');
    expect(readable('Pattern Б')).toBe('Pattern B');
    expect(readable('Tempo (bpm)')).toBe('Tempo (bpm)');
  });
});

describe('the lettering', () => {
  const latin = /^[\x20-\x7e]*$/;

  it('has English for every word, in letters the readout can draw', () => {
    const words = (value: unknown): string[] =>
      typeof value === 'string' ? [value] : Object.values(value as object).flatMap(words);
    for (const word of words(LETTERING.english)) expect(word, word).toMatch(latin);
  });

  it('keeps the Russian lettering the picture is painted with', () => {
    expect(LETTERING.russian.patterns).toEqual(['А', 'Б', 'В', 'Г']);
    expect(LETTERING.russian.voices.snare.key).toBe('МАЛЫЙ');
  });

  it('lays every English label inside the picture', () => {
    const inside = ([left, top, right, bottom]: Rect) =>
      left >= 0 && top >= 0 && right <= PLATE.width && bottom <= PLATE.height && right > left && bottom > top;
    for (const label of PLATE_LABELS) {
      expect(inside(label.rect), label.text).toBe(true);
      expect(label.text, label.text).toMatch(latin);
    }
  });

  it('relabels each of the eight instrument keys and four pattern keys', () => {
    const keys = PLATE_LABELS.filter((label) => label.on === 'key').map((label) => label.text);
    expect(keys).toEqual(expect.arrayContaining(['KICK', 'SNARE', 'PERC', 'A.', 'B.', 'C.', 'D.', 'CLEAR']));
  });
});

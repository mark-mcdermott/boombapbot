import { describe, expect, it } from 'vitest';
import { adoptEarlier, countHits, isEmptyPattern, parseProject } from '../src/document';
import { codec, earlier, newProject } from './helpers';

describe('a beat from before РИТМ-12', () => {
  it('opens as a РИТМ-12 beat: its tempo, its selected rhythm and its accents', () => {
    const read = codec.parse(earlier(2));
    if (!read.ok) throw new Error(read.errors.join('; '));
    const { project, changes } = read;
    expect(parseProject(project).ok).toBe(true);
    expect(project).toMatchObject({ machine: 'ritm12', schemaVersion: 4, id: 'fixture-mixed-rhythms', tempo: 124, size: 16 });
    const [first, ...rest] = project.patterns;
    expect(first!.steps.kick).toBe('x...x...x..xx...');
    expect(first!.steps.snare).toBe('....x.......x..x');
    expect(first!.steps.closed_hat).toBe('x.x.x.x.x.x.x.x.');
    expect(first!.accents).toBe('x.......x.......');
    expect(rest.every(isEmptyPattern)).toBe(true);
    // The level of a folded voice is the loudest of what it was folded from.
    expect(project.mix).toMatchObject({ volume: 0.75, accent: 0.75 });
    expect(project.mix.levels.perc).toBe(0.75);
    expect(changes[0]).toBe('It was made on an earlier machine and is now a РИТМ-12 beat.');
    expect(changes).toContain('Rhythm 1, version A, is now pattern А.');
    expect(changes).toContain('Its version B was left behind.');
    expect(changes).toContain('4 other rhythms were left behind.');
    expect(changes).toContain('Its rhythm tracks were left behind.');
    expect(changes).toContain('Its congas, claves and maracas are not on this machine.');
  });

  it('says only what was really lost', () => {
    const plain = earlier(2) as {
      rhythms: Array<{ a: Record<string, string>; b: Record<string, string> }>;
      rhythmTracks: number[][];
      sound: { alternates: Record<string, boolean> };
    };
    const empty = '.'.repeat(32);
    plain.rhythms.forEach((rhythm, index) => {
      for (const track of Object.keys(rhythm.b)) rhythm.b[track] = empty;
      if (index > 0) for (const track of Object.keys(rhythm.a)) rhythm.a[track] = empty;
    });
    plain.rhythmTracks = plain.rhythmTracks.map(() => []);
    for (const track of Object.keys(plain.sound.alternates)) plain.sound.alternates[track] = false;
    const read = adoptEarlier(plain);
    expect(read?.ok && read.changes).toEqual([
      'It was made on an earlier machine and is now a РИТМ-12 beat.',
      'Rhythm 1, version A, is now pattern А.',
      'The sounds are this machine’s own, so its sound knobs start at rest.',
    ]);
  });

  it('folds three toms into one, and the cowbell and cymbal into the percussion voice', () => {
    const beat = earlier(2) as { rhythms: Array<{ a: Record<string, string> }> };
    const a = beat.rhythms[0]!.a;
    a.low_tom = `x...............${'.'.repeat(16)}`;
    a.mid_tom = `....x...........${'x'.repeat(16)}`;
    a.high_tom = `........x.......${'.'.repeat(16)}`;
    a.cowbell = `..x.............${'.'.repeat(16)}`;
    a.cymbal = `..........x.....${'.'.repeat(16)}`;
    a.rim_shot = `.x..............${'.'.repeat(16)}`;
    const read = adoptEarlier(beat);
    if (!read?.ok) throw new Error('not adopted');
    expect(read.project.patterns[0]!.steps).toMatchObject({
      tom: 'x...x...x.......',
      perc: '..x.......x.....',
      rim: '.x..............',
    });
    expect(read.changes).toContain('Its three toms now play on the one ТОМ.');
    expect(read.changes).toContain('Its cowbell and cymbal now both play on ПЕРК.');
    expect(read.changes).toContain('Only its first 16 steps were kept.');
  });

  it('keeps triplets as the twelve-step size, and says when a step size has no place here', () => {
    const beat = earlier(2) as { rhythms: Array<{ preScale: number; firstLength: number }> };
    beat.rhythms[0]!.preScale = 1;
    beat.rhythms[0]!.firstLength = 12;
    const triplets = adoptEarlier(beat);
    expect(triplets?.ok && triplets.project.size).toBe(12);
    beat.rhythms[0]!.preScale = 4;
    beat.rhythms[0]!.firstLength = 9;
    const fast = adoptEarlier(beat);
    if (!fast?.ok) throw new Error('not adopted');
    expect(fast.project.size).toBe(16);
    expect(fast.changes).toContain('Its steps were thirty-second notes. They play as sixteenths here, at half the speed.');
    expect(fast.changes).toContain('It was 9 steps long. A measure here is 16.');
  });

  it('opens the oldest beats too, keeping their swing', () => {
    const read = codec.parse(earlier(1));
    if (!read.ok) throw new Error(read.errors.join('; '));
    const { project, changes } = read;
    expect(parseProject(project).ok).toBe(true);
    expect(project).toMatchObject({ id: 'fixture-kick-snare-hat', tempo: 124, size: 16 });
    expect(project.swing).toBeCloseTo(0.24, 10);
    const [first] = project.patterns;
    expect(first!.steps.kick).toBe('x...x...x..xx...');
    expect(first!.steps.snare).toBe('....x.......x..x');
    expect(first!.accents).toBe('x.......x.......');
    expect(countHits(first!)).toBeGreaterThan(15);
    expect(changes).toContain('Each hit had its own velocity. Steps are now on or off, and the loudest ones are accented.');
  });

  it('leaves alone what is not one, and says what is wrong with a damaged one', () => {
    for (const other of [null, 'a beat', 7, {}, newProject(), { schemaVersion: 4 }]) expect(adoptEarlier(other)).toBeNull();
    const damaged = { ...(earlier(2) as object), rhythms: [] };
    const read = adoptEarlier(damaged);
    expect(read?.ok).toBe(false);
    expect(codec.parse(damaged).ok).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BPM_MAX,
  BPM_MIN,
  EMPTY_ROW,
  INSTRUMENT_IDS,
  MAX_STEPS,
  PANEL,
  PATTERN_COUNT,
  PROJECT_FORMAT,
  RHYTHM_COUNT,
  ROLES,
  ROLE_IDS,
  SWITCHED_IDS,
  TRACKS,
  TRACK_IDS,
  accentGains,
  clampKnob,
  countHits,
  countSteps,
  createDefaultSound,
  createEmptyRhythm,
  createProject,
  createStarterRhythms,
  getTrack,
  isStepOn,
  knobPosition,
  levelGain,
  masterGain,
  parseProject,
  parseProjectText,
  patternIndex,
  rhythmLength,
  rowMask,
  serializeProject,
  stepsPerBeat,
  tempoBpm,
  tempoFromBpm,
  trackRole,
  withKnob,
  withStep,
} from '../src';

function read(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

const fixtureText = read('mixed-rhythms.project.json');
const v1Text = read('v1-kick-snare-hat.project.json');

function clone(): Record<string, any> {
  return JSON.parse(fixtureText) as Record<string, any>;
}

describe('project schema', () => {
  it('accepts the shared fixture', () => {
    const result = parseProjectText(fixtureText);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes).toEqual([]);
    expect(result.project.rhythms).toHaveLength(RHYTHM_COUNT);
    expect(result.project.rhythms.map(rhythmLength).slice(0, 4)).toEqual([16, 12, 32, 24]);
    expect(countHits(result.project.rhythms[0]!, 'a')).toBe(16);
    expect(tempoBpm(result.project.tempo)).toBeCloseTo(124, 1);
  });

  it('round-trips through serialization without change', () => {
    const first = parseProjectText(fixtureText);
    if (!first.ok) throw new Error('fixture must parse');
    const second = parseProjectText(serializeProject(first.project));
    expect(second).toEqual(first);
  });

  it('creates a valid project with the starter rhythms', () => {
    const project = createProject({ id: 'p', now: new Date('2026-02-03T04:05:06Z'), name: 'Mine', bpm: 118 });
    expect(parseProject(project)).toEqual({ ok: true, project, changes: [] });
    expect(project.format).toBe(PROJECT_FORMAT);
    expect(tempoBpm(project.tempo)).toBeCloseTo(118, 1);
    expect(countHits(project.rhythms[0]!, 'a')).toBeGreaterThan(10);
    expect(project.rhythms.slice(1).every((rhythm) => countHits(rhythm, 'a') + countHits(rhythm, 'b') === 0)).toBe(
      true,
    );
    expect(project.sound.levels.kick).toBe(0.75);
    expect(project.sound.alternates).toEqual({
      low_tom: false,
      mid_tom: false,
      high_tom: false,
      rim_shot: false,
      clap: false,
    });
    expect(project.rhythmTracks).toEqual(Array.from({ length: 12 }, () => []));
  });

  const rejected: Array<[string, (project: Record<string, any>) => void]> = [
    ['another format', (p) => (p.format = 'other')],
    ['a later schema version', (p) => (p.schemaVersion = 3)],
    ['fifteen rhythms', (p) => p.rhythms.pop()],
    ['a row of 31 steps', (p) => (p.rhythms[0].a.kick = p.rhythms[0].a.kick.slice(1))],
    ['a row with another character', (p) => (p.rhythms[0].a.kick = `X${p.rhythms[0].a.kick.slice(1)}`)],
    ['a version missing a track', (p) => delete p.rhythms[0].b.cowbell],
    ['a 1st part of no steps', (p) => (p.rhythms[0].firstLength = 0)],
    ['a 2nd part of 17 steps', (p) => (p.rhythms[0].secondLength = 17)],
    ['pre-scale 5', (p) => (p.rhythms[0].preScale = 5)],
    ['a tempo stop past the last', (p) => (p.tempo.coarse = 40)],
    ['a fine tempo beyond its travel', (p) => (p.tempo.fine = 1.5)],
    ['a knob past fully right', (p) => (p.sound.knobs.kick.decay = 1.1)],
    ['a level below zero', (p) => (p.sound.levels.snare = -0.1)],
    ['a missing level', (p) => delete p.sound.levels.cymbal],
    ['a switch on a track without one', (p) => (p.sound.alternates.kick = true)],
    ['a rhythm track of 65 measures', (p) => (p.rhythmTracks[0] = new Array(65).fill(0))],
    ['a rhythm track naming rhythm 16', (p) => (p.rhythmTracks[0] = [16])],
    ['eleven rhythm tracks', (p) => p.rhythmTracks.pop()],
    ['an unknown mode', (p) => (p.panel.mode = 'record')],
    ['an auto fill-in every 3 measures', (p) => (p.panel.autoFill = 3)],
    ['an intro/fill-in outside its buttons', (p) => (p.panel.fillRhythm = 3)],
  ];
  for (const [name, change] of rejected) {
    it(`rejects ${name}`, () => {
      const project = clone();
      change(project);
      const result = parseProject(project);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    });
  }

  it('rejects text that is not a project', () => {
    expect(parseProjectText('not json').ok).toBe(false);
    expect(parseProjectText('[]').ok).toBe(false);
    expect(parseProjectText('null').ok).toBe(false);
    expect(parseProjectText('x'.repeat(1_000_001)).ok).toBe(false);
  });

  it('never throws on hostile input', () => {
    for (const input of [undefined, null, 0, 'text', [], { format: PROJECT_FORMAT }, { schemaVersion: 2 }]) {
      expect(() => parseProject(input)).not.toThrow();
      expect(parseProject(input).ok).toBe(false);
    }
  });
});

describe('version 1 projects', () => {
  it('become Basic Rhythm 1 A, on and off, with an accent row', () => {
    const result = parseProjectText(v1Text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const v1 = JSON.parse(v1Text) as Record<string, any>;
    const { project } = result;
    expect(project.schemaVersion).toBe(2);
    expect(project.id).toBe(v1.id);
    expect(project.name).toBe(v1.name);
    expect(tempoBpm(project.tempo)).toBeCloseTo(v1.bpm, 1);

    const version = project.rhythms[0]!.a;
    for (const lane of v1.pattern.lanes as Array<{ role: keyof typeof version; steps: number[] }>) {
      lane.steps.forEach((velocity, step) => expect(isStepOn(version[lane.role], step)).toBe(velocity > 0));
    }
    // The fixture's kick hits at velocity 127 land on steps 1 and 9.
    expect(version.accent.slice(0, 16)).toBe('x.......x.......');
    expect(countSteps(version.mid_tom, MAX_STEPS)).toBe(0);
    expect(rhythmLength(project.rhythms[0]!)).toBe(16);
    expect(project.rhythms.slice(1)).toEqual(Array.from({ length: RHYTHM_COUNT - 1 }, createEmptyRhythm));
    expect(countHits(project.rhythms[0]!, 'b')).toBe(0);
  });

  it('say what was lost', () => {
    const result = parseProjectText(v1Text);
    if (!result.ok) throw new Error('v1 fixture must parse');
    expect(result.changes).toHaveLength(2);
    expect(result.changes[0]).toMatch(/velocity/);
    expect(result.changes[1]).toMatch(/Swing of 56%/);

    const other = JSON.parse(v1Text) as Record<string, any>;
    other.swing = 50;
    other.kit.id = '909';
    for (const lane of other.pattern.lanes) lane.steps = lane.steps.map((v: number) => (v > 0 ? 100 : 0));
    const plain = parseProject(other);
    if (!plain.ok) throw new Error('v1 project must parse');
    expect(plain.changes).toEqual(['It was made on the 909 kit and now plays on the 808.']);
    expect(countSteps(plain.project.rhythms[0]!.a.accent, MAX_STEPS)).toBe(0);
  });

  it('are still checked before they are converted', () => {
    const broken = JSON.parse(v1Text) as Record<string, any>;
    broken.bpm = 9000;
    expect(parseProject(broken).ok).toBe(false);
    const short = JSON.parse(v1Text) as Record<string, any>;
    short.pattern.lanes.pop();
    expect(parseProject(short).ok).toBe(false);
  });
});

describe('roles and tracks', () => {
  it('keeps sound slots stable and appends new ones', () => {
    expect(ROLES.map((role) => role.index)).toEqual(ROLE_IDS.map((_, index) => index));
    expect(ROLE_IDS.slice(0, 8)).toEqual([
      'kick',
      'snare',
      'closed_hat',
      'open_hat',
      'low_tom',
      'high_tom',
      'clap',
      'cymbal',
    ]);
    expect(ROLE_IDS).toHaveLength(16);
    expect(ROLES.map((role) => role.gmNote)).toEqual([36, 38, 42, 46, 45, 50, 39, 49, 47, 37, 56, 64, 63, 62, 75, 70]);
  });

  it('lists the twelve tracks in panel order, the accent first', () => {
    expect(TRACKS.map((track) => track.id)).toEqual([...TRACK_IDS]);
    expect(TRACKS.map((track) => track.short)).toEqual([
      'AC', 'BD', 'SD', 'LT', 'MT', 'HT', 'RS', 'CP', 'CB', 'CY', 'OH', 'CH',
    ]);
    expect(TRACKS.map((track) => track.index)).toEqual(TRACK_IDS.map((_, index) => index));
    expect(getTrack('accent').sound).toBeUndefined();
  });

  it('gives every instrument one sound, and five of them an alternate', () => {
    const sounds = INSTRUMENT_IDS.map((id) => trackRole(id, false).id);
    const alternates = SWITCHED_IDS.map((id) => trackRole(id, true).id);
    expect(new Set([...sounds, ...alternates]).size).toBe(ROLE_IDS.length);
    expect(alternates).toEqual(['low_conga', 'mid_conga', 'high_conga', 'claves', 'maracas']);
    // A track without a switch plays the same sound either way.
    expect(trackRole('kick', true).id).toBe('kick');
    expect(getTrack('open_hat').chokeGroup).toBe(getTrack('closed_hat').chokeGroup);
    expect(getTrack('open_hat').chokeGroup).toBeGreaterThan(0);
  });
});

describe('rhythm rows and geometry', () => {
  it('turn steps on and off and pack into a mask', () => {
    let row = EMPTY_ROW;
    expect(row).toHaveLength(MAX_STEPS);
    row = withStep(row, 0, true);
    row = withStep(row, 31, true);
    row = withStep(row, 5, true);
    row = withStep(row, 5, false);
    expect(isStepOn(row, 0)).toBe(true);
    expect(isStepOn(row, 5)).toBe(false);
    expect(rowMask(row)).toBe(0x80000001);
    expect(countSteps(row, 16)).toBe(1);
    expect(countSteps(row, 32)).toBe(2);
    expect(withStep(row, 40, true)).toBe(row);
  });

  it('maps pre-scales to steps per beat and rhythms to engine patterns', () => {
    expect([1, 2, 3, 4].map((scale) => stepsPerBeat(scale as 1 | 2 | 3 | 4))).toEqual([3, 6, 4, 8]);
    expect(patternIndex(0, 'a')).toBe(0);
    expect(patternIndex(0, 'b')).toBe(1);
    expect(patternIndex(15, 'b')).toBe(PATTERN_COUNT - 1);
    expect(createStarterRhythms()).toHaveLength(RHYTHM_COUNT);
  });
});

describe('tempo and mix', () => {
  it('covers 40 to 300 with forty click stops and a fine knob', () => {
    expect(tempoBpm({ coarse: 0, fine: 0 })).toBe(BPM_MIN);
    expect(tempoBpm({ coarse: 39, fine: 0 })).toBe(BPM_MAX);
    expect(tempoBpm({ coarse: 0, fine: -1 })).toBe(BPM_MIN);
    expect(tempoBpm({ coarse: 39, fine: 1 })).toBe(BPM_MAX);
    for (const bpm of [40, 61.5, 118, 120, 174, 299, 300]) {
      const tempo = tempoFromBpm(bpm);
      expect(Number.isInteger(tempo.coarse)).toBe(true);
      expect(Math.abs(tempo.fine)).toBeLessThanOrEqual(0.5);
      expect(tempoBpm(tempo)).toBeCloseTo(bpm, 1);
    }
    expect(tempoBpm(tempoFromBpm(9000))).toBe(BPM_MAX);
    expect(tempoBpm(tempoFromBpm(Number.NaN))).toBeCloseTo(120, 1);
  });

  it('turns knob positions into gains', () => {
    expect(levelGain('kick', 0)).toBe(0);
    expect(levelGain('kick', 0.75)).toBeCloseTo(getTrack('kick').trim, 6);
    expect(levelGain('kick', 1)).toBeGreaterThan(levelGain('kick', 0.75));
    expect(accentGains(0)).toEqual({ plain: 0.6, accented: 0.6 });
    expect(accentGains(1).accented).toBe(1);
    expect(accentGains(0.5).accented).toBeCloseTo(0.8, 6);
    expect(masterGain(0)).toBe(0);
    expect(masterGain(1)).toBe(1);
    expect(clampKnob(7)).toBe(1);
    expect(clampKnob(Number.NaN)).toBe(0.5);
  });
});

describe('the 808 panel', () => {
  const { width, height } = PANEL.faceplate;

  it('keeps every control inside the faceplate', () => {
    const rects = [
      ...PANEL.steps.map((step) => step.hit),
      ...PANEL.transport.map((control) => control.hit),
      ...PANEL.voiceSelect.positions.map((position) => position.hit),
      ...PANEL.switches.flatMap((entry) => [entry.hit, entry.slot]),
    ];
    for (const [x, y, w, h] of rects) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(width);
      expect(y + h).toBeLessThanOrEqual(height);
    }
    PANEL.steps.forEach((step, i) => {
      if (i > 0) expect(step.hit[0]).toBeGreaterThanOrEqual(PANEL.steps[i - 1]!.hit[0] + PANEL.steps[i - 1]!.hit[2] - 0.01);
    });
  });

  it('has a selector position for every track, in order', () => {
    expect(PANEL.voiceSelect.positions.map((position) => position.track)).toEqual([...TRACK_IDS]);
    expect(PANEL.voiceSelect.positions.map((position) => position.label)).toEqual(TRACKS.map((track) => track.short));
  });

  it('has a level knob for every column and a knob for each of its sound controls', () => {
    for (const knob of [...PANEL.knobs, PANEL.tempo, PANEL.fine, PANEL.master]) {
      expect(knob.cx - knob.r).toBeGreaterThanOrEqual(0);
      expect(knob.cx + knob.r).toBeLessThanOrEqual(width);
      expect(knob.cy + knob.r).toBeLessThanOrEqual(height);
      expect(knob.minDeg).toBeLessThan(knob.maxDeg);
      expect(knob.photoDeg).toBeGreaterThanOrEqual(knob.minDeg);
      expect(knob.photoDeg).toBeLessThanOrEqual(knob.maxDeg);
    }
    const listed = PANEL.knobs.map((knob) => `${knob.track}:${knob.param}`).sort();
    const expected = [
      ...TRACK_IDS.map((id) => `${id}:level`),
      ...INSTRUMENT_IDS.flatMap((id) => getTrack(id).knobs.map((param) => `${id}:${param}`)),
    ].sort();
    expect(listed).toEqual(expected);
    expect(listed).toHaveLength(22);
  });

  it('has a switch under each alternate sound, inside the area that throws it', () => {
    expect(PANEL.switches.map((entry) => entry.track)).toEqual([...SWITCHED_IDS]);
    for (const { hit, slot } of PANEL.switches) {
      expect(slot[0]).toBeGreaterThanOrEqual(hit[0]);
      expect(slot[0] + slot[2]).toBeLessThanOrEqual(hit[0] + hit[2]);
      expect(slot[1]).toBeGreaterThanOrEqual(hit[1]);
      expect(slot[1] + slot[3]).toBeLessThanOrEqual(hit[1] + hit[3]);
    }
  });

  it('is drawn for boombapbot, so it carries no credit', () => {
    expect(PANEL.faceplate.original).toBe(true);
    expect(PANEL.faceplate.credit).toBeUndefined();
    expect(PANEL.faceplate.file).toMatch(/\.svg$/);
  });
});

describe('knobs', () => {
  it('reads and turns the knob of any column', () => {
    const sound = createDefaultSound();
    expect(knobPosition(sound, 'accent', 'level')).toBe(sound.accent);
    expect(knobPosition(sound, 'cowbell', 'level')).toBe(0.75);
    expect(knobPosition(sound, 'snare', 'snappy')).toBe(0.5);

    const turned = withKnob(withKnob(withKnob(sound, 'accent', 'level', 0.2), 'cowbell', 'level', 2), 'snare', 'snappy', -1);
    expect(turned.accent).toBe(0.2);
    expect(turned.levels.cowbell).toBe(1);
    expect(turned.knobs.snare.snappy).toBe(0);
    // Nothing else moved, and the original is untouched.
    expect(turned.levels.kick).toBe(sound.levels.kick);
    expect(turned.knobs.kick).toBe(sound.knobs.kick);
    expect(turned.master).toBe(sound.master);
    expect(sound.accent).toBe(0.75);
  });
});

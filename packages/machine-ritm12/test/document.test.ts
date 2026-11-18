import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT } from '@boombapbot/contracts';
import {
  BPM_MAX,
  BPM_MIN,
  PATTERN_COUNT,
  STEPS,
  VOICES,
  VOICE_IDS,
  accentGains,
  bpmAtKnob,
  countHits,
  createEmptyPattern,
  documentRitm12,
  engineSwing,
  isEmptyPattern,
  levelGain,
  masterGain,
  parseProject,
  rowMask,
  serializeProject,
  stepsPerBeat,
  tempoKnob,
  withStep,
} from '../src/document';
import { codec, earlier, newProject } from './helpers';

describe('the РИТМ-12 project document', () => {
  it('names its machine, and a new one opens on the starter patterns', () => {
    const project = newProject();
    expect(project).toMatchObject({ format: PROJECT_FORMAT, schemaVersion: 3, machine: 'ritm12', tempo: 104, size: 16 });
    expect(project.patterns).toHaveLength(PATTERN_COUNT);
    expect(countHits(project.patterns[0]!)).toBeGreaterThan(8);
    expect(countHits(project.patterns[1]!)).toBeGreaterThan(countHits(project.patterns[0]!));
    expect(isEmptyPattern(project.patterns[2]!)).toBe(true);
    expect(isEmptyPattern(project.patterns[3]!)).toBe(true);
    for (const pattern of project.patterns) {
      expect(pattern.accents).toHaveLength(STEPS);
      for (const id of VOICE_IDS) expect(pattern.steps[id]).toMatch(/^[.x]{16}$/);
    }
  });

  it('goes to text and back unchanged', () => {
    const project = newProject();
    const read = codec.parseText(serializeProject(project));
    expect(read).toEqual({ ok: true, project, changes: [] });
    expect(codec.serialize(project)).toBe(serializeProject(project));
  });

  it('refuses what is not one', () => {
    const project = newProject();
    const broken: Array<[string, unknown]> = [
      ['a tempo past the knob', { ...project, tempo: BPM_MAX + 1 }],
      ['a tempo that is not whole', { ...project, tempo: 120.5 }],
      ['a size the switch does not have', { ...project, size: 8 }],
      ['three patterns', { ...project, patterns: project.patterns.slice(1) }],
      ['a row of the wrong length', { ...project, patterns: project.patterns.map((p) => ({ ...p, accents: 'x' })) }],
      ['a voice missing', { ...project, voices: { ...project.voices, kick: undefined } }],
      ['an effect it does not have', { ...project, effect: { kind: 'phaser', mix: 0.5 } }],
      ['a knob past its end', { ...project, swing: 1.2 }],
      ['a pattern it does not have', { ...project, panel: { ...project.panel, pattern: 4 } }],
    ];
    for (const [what, value] of broken) expect(parseProject(value).ok, what).toBe(false);
    expect(codec.parse({ ...project, machine: 'another' })).toEqual({
      ok: false,
      errors: ['This project was made on a machine this build does not have.'],
    });
    expect(codec.parse({ ...project, format: 'something.else' }).ok).toBe(false);
  });

  it('reads the committed fixture of a current beat and writes it back unchanged', () => {
    const text = readFileSync(new URL('../fixtures/four-patterns.project.json', import.meta.url), 'utf8');
    const read = codec.parseText(text);
    if (!read.ok) throw new Error(read.errors.join('; '));
    expect(read.changes).toEqual([]);
    expect(codec.serialize(read.project)).toBe(text);
  });

  it('owns only its own documents, and keeps its draft in a place of its own', () => {
    expect(documentRitm12.owns({ machine: 'ritm12', schemaVersion: 3 })).toBe(true);
    expect(documentRitm12.owns({ schemaVersion: 2 })).toBe(false);
    expect(documentRitm12.draftKey).toBe('boombapbot.draft.v3.ritm12');
    expect(documentRitm12.earlierDraftKeys).toEqual(['boombapbot.draft.v2', 'boombapbot.draft.v1']);
    // What the server asks: only this machine's own, never a beat taken over.
    expect(codec.parseOwned(earlier(2)).ok).toBe(false);
    expect(codec.parseOwned(newProject()).ok).toBe(true);
    // The page takes one over, and is told that it did.
    expect(codec.parse(earlier(2))).toMatchObject({ ok: true, adopted: true });
    expect(codec.parse(newProject())).not.toHaveProperty('adopted');
  });
});

describe('the voices and the arithmetic of the knobs', () => {
  it('has eight voices in a fixed order, the hats cutting each other off', () => {
    expect(VOICES.map((voice) => voice.id)).toEqual([...VOICE_IDS]);
    expect(VOICES.map((voice) => voice.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(VOICES.filter((voice) => voice.chokeGroup !== 0).map((voice) => voice.id)).toEqual(['closed_hat', 'open_hat']);
    expect(new Set(VOICES.map((voice) => voice.gmNote)).size).toBe(8);
    expect(VOICES.every((voice) => /[А-Я]/.test(voice.label) && /^[A-Z]/.test(voice.name))).toBe(true);
  });

  it('turns rows into the engine\'s bits', () => {
    expect(rowMask(createEmptyPattern().accents)).toBe(0);
    expect(rowMask(withStep(withStep('.'.repeat(STEPS), 0, true), 15, true))).toBe(0x8001);
    expect(withStep('.'.repeat(STEPS), 16, true)).toBe('.'.repeat(STEPS));
    expect([stepsPerBeat(16), stepsPerBeat(12)]).toEqual([4, 3]);
  });

  it('runs the tempo knob from one end of the range to the other in whole beats a minute', () => {
    expect([bpmAtKnob(0), bpmAtKnob(1), bpmAtKnob(-1), bpmAtKnob(2)]).toEqual([BPM_MIN, BPM_MAX, BPM_MIN, BPM_MAX]);
    for (const bpm of [40, 97, 120, 174, 300]) expect(bpmAtKnob(tempoKnob(bpm))).toBe(bpm);
  });

  it('plays a voice at its trim with the level knob at rest, and silent with it down', () => {
    for (const voice of VOICES) {
      expect(levelGain(voice.id, 0.75)).toBeCloseTo(voice.trim, 10);
      expect(levelGain(voice.id, 0)).toBe(0);
      expect(levelGain(voice.id, 1)).toBeGreaterThan(voice.trim);
    }
    expect(accentGains(0)).toEqual({ plain: 1, accented: 1 });
    expect(accentGains(1).plain).toBeCloseTo(0.4, 10);
    expect([masterGain(0), masterGain(1)]).toEqual([0, 1]);
    expect([engineSwing(0), engineSwing(0.5), engineSwing(1)]).toEqual([0, 64, 128]);
  });
});

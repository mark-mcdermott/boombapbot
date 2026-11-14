import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  KITS,
  KIT_IDS,
  PANELS,
  PROJECT_FORMAT,
  ROLES,
  ROLE_IDS,
  countHits,
  createProject,
  createStarterPattern,
  panelRoles,
  parseProject,
  parseProjectText,
  rolesOutsidePanel,
  serializeProject,
  substitutedRoles,
} from '../src';

const fixtureText = readFileSync(
  new URL('../fixtures/kick-snare-hat.project.json', import.meta.url),
  'utf8',
);
const fixture = JSON.parse(fixtureText) as Record<string, any>;

function clone(): Record<string, any> {
  return JSON.parse(fixtureText) as Record<string, any>;
}

describe('project schema', () => {
  it('accepts the shared fixture', () => {
    const result = parseProject(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.format).toBe(PROJECT_FORMAT);
    expect(result.project.pattern.lanes).toHaveLength(8);
    expect(countHits(result.project.pattern)).toBe(22);
  });

  it('round-trips through serialization without change', () => {
    const first = parseProjectText(fixtureText);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = parseProjectText(serializeProject(first.project));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.project).toEqual(first.project);
  });

  it('creates a valid starter project', () => {
    const project = createProject({
      id: 'test',
      now: new Date('2026-02-03T04:05:06.000Z'),
      pattern: createStarterPattern(),
    });
    expect(parseProject(JSON.parse(serializeProject(project))).ok).toBe(true);
    expect(countHits(project.pattern)).toBeGreaterThan(10);
    expect(project.createdAt).toBe('2026-02-03T04:05:06.000Z');
  });

  const invalid: Array<[string, (doc: Record<string, any>) => void, RegExp]> = [
    ['a different format', (doc) => { doc.format = 'something.else'; }, /not a boombapbot project/],
    ['a newer schema version', (doc) => { doc.schemaVersion = 2; }, /schema version 2/],
    ['a tempo that is too fast', (doc) => { doc.bpm = 900; }, /bpm/],
    ['a tempo that is not a number', (doc) => { doc.bpm = '120'; }, /bpm/],
    ['swing out of range', (doc) => { doc.swing = 20; }, /swing/],
    ['an unknown kit', (doc) => { doc.kit.id = '303'; }, /kit\.id/],
    ['a velocity above 127', (doc) => { doc.pattern.lanes[0].steps[0] = 128; }, /steps/],
    ['a fractional velocity', (doc) => { doc.pattern.lanes[0].steps[0] = 1.5; }, /steps/],
    ['a lane with 15 steps', (doc) => { doc.pattern.lanes[1].steps.pop(); }, /steps/],
    ['a missing lane', (doc) => { doc.pattern.lanes.pop(); }, /lanes/],
    ['a duplicated role', (doc) => { doc.pattern.lanes[1].role = 'kick'; }, /exactly one lane/],
    ['an unknown role', (doc) => { doc.pattern.lanes[1].role = 'cowbell'; }, /role/],
    ['a missing name', (doc) => { delete doc.name; }, /name/],
    ['a 32-step pattern', (doc) => { doc.pattern.stepCount = 32; }, /stepCount/],
    ['a bad timestamp', (doc) => { doc.updatedAt = 'yesterday'; }, /updatedAt/],
  ];

  it.each(invalid)('rejects %s', (_label, mutate, message) => {
    const doc = clone();
    mutate(doc);
    const result = parseProject(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(message);
  });

  it('rejects text that is not a project', () => {
    for (const text of ['', 'not json', '[]', 'null', '42', '{"format":"boombapbot.project"}']) {
      expect(parseProjectText(text).ok).toBe(false);
    }
    expect(parseProjectText('x'.repeat(2_000_000)).ok).toBe(false);
  });

  it('never throws on hostile input', () => {
    const inputs: unknown[] = [undefined, null, 1, 'x', [], {}, { format: PROJECT_FORMAT, schemaVersion: 1, pattern: null }];
    for (const input of inputs) expect(() => parseProject(input)).not.toThrow();
  });
});

describe('roles and kits', () => {
  it('keeps role slots stable', () => {
    expect(ROLES.map((role) => role.id)).toEqual([...ROLE_IDS]);
    expect(ROLES.map((role) => role.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(ROLES.map((role) => role.gmNote)).toEqual([36, 38, 42, 46, 45, 50, 39, 49]);
  });

  it('maps every role in every kit to a file', () => {
    for (const id of KIT_IDS) {
      const kit = KITS[id];
      expect(kit.id).toBe(id);
      expect(kit.demo).toBe(true);
      expect(Object.keys(kit.voices).sort()).toEqual([...ROLE_IDS].sort());
      // Hats share a choke group so a closed hat stops an open one.
      expect(kit.voices.closed_hat.chokeGroup).toBeGreaterThan(0);
      expect(kit.voices.closed_hat.chokeGroup).toBe(kit.voices.open_hat.chokeGroup);
      for (const role of ROLE_IDS) {
        const path = new URL(`../../../assets/${kit.assetBase}/${kit.voices[role].file}`, import.meta.url);
        expect(readFileSync(path).subarray(0, 4).toString()).toBe('RIFF');
      }
    }
  });

  it('declares substituted voices', () => {
    expect(substitutedRoles(KITS['606'])).toEqual(['clap']);
    expect(substitutedRoles(KITS['808'])).toEqual([]);
  });
});

describe('hardware panels', () => {
  it('have valid geometry inside the faceplate', () => {
    const panels = Object.values(PANELS);
    expect(panels.length).toBeGreaterThan(0);
    for (const panel of panels) {
      const { width, height } = panel.faceplate;
      const rects = [
        ...panel.steps.map((step) => step.hit),
        ...panel.transport.map((control) => control.hit),
        ...panel.voiceSelect.positions.map((position) => position.hit),
      ];
      for (const [x, y, w, h] of rects) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(width);
        expect(y + h).toBeLessThanOrEqual(height);
      }
      // Step buttons run left to right without overlapping.
      panel.steps.forEach((step, i) => {
        if (i > 0) expect(step.hit[0]).toBeGreaterThanOrEqual(panel.steps[i - 1]!.hit[0] + panel.steps[i - 1]!.hit[2] - 0.01);
      });
      expect(panelRoles(panel).length).toBeGreaterThanOrEqual(6);
      expect([...panelRoles(panel), ...rolesOutsidePanel(panel)].sort()).toEqual([...ROLE_IDS].sort());
    }
  });
});

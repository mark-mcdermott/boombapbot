import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countHits, isStepOn, patternIndex, serializeProject, tempoBpm } from '@boombapbot/contracts';
import { selectedPattern } from '../src/engine';
import {
  DRAFT_KEY,
  LEGACY_DRAFT_KEY,
  UNREADABLE_DRAFT_KEY,
  loadDraft,
  saveDraft,
  type KeyValueStorage,
} from '../src/state/draft-storage';
import { exportBaseName, projectFileName, readProjectFile } from '../src/state/project-io';
import { EditorStore, editTarget } from '../src/state/store';
import { fixturePath, legacyFixturePath, loadFixture } from './helpers';

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded');
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

function makeStore(): EditorStore {
  let tick = 0;
  return new EditorStore({
    project: loadFixture(),
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, (tick += 1))),
    newId: () => 'test-id',
  });
}

function hits(store: EditorStore, rhythm = 0): number {
  return countHits(store.getState().project.rhythms[rhythm]!, 'a');
}

describe('editor store', () => {
  it('toggles a step of the selected track with a step button', () => {
    const store = makeStore();
    const row = () => store.getState().project.rhythms[0]!.a.kick;
    expect(editTarget(store.getState().project)).toEqual({ rhythm: 0, variation: 'a', track: 'kick', offset: 0 });
    expect(isStepOn(row(), 1)).toBe(false);
    expect(store.pressStep(1)).toEqual({ kind: 'step', on: true });
    expect(isStepOn(row(), 1)).toBe(true);
    expect(store.pressStep(1)).toEqual({ kind: 'step', on: false });
    expect(isStepOn(row(), 1)).toBe(false);
  });

  it('writes to the track the selector points at, the accent included', () => {
    const store = makeStore();
    store.selectTrack('accent');
    store.pressStep(3);
    store.selectTrack('cowbell');
    store.pressStep(5);
    const { a } = store.getState().project.rhythms[0]!;
    expect(isStepOn(a.accent, 3)).toBe(true);
    expect(isStepOn(a.cowbell, 5)).toBe(true);
    // Selecting a track is not something to undo.
    store.undo();
    store.undo();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().project.panel.selector).toBe(8);
  });

  it('leaves every other rhythm alone', () => {
    const store = makeStore();
    const before = store.getState().project.rhythms;
    store.pressStep(2);
    const after = store.getState().project.rhythms;
    expect(after[0]).not.toBe(before[0]);
    for (let index = 1; index < after.length; index += 1) expect(after[index]).toBe(before[index]);
    expect(store.getState().project.rhythms[0]!.b).toBe(before[0]!.b);
  });

  it('clears the selected rhythm and can undo it', () => {
    const store = makeStore();
    const before = hits(store);
    expect(before).toBeGreaterThan(0);
    store.clearRhythm();
    expect(hits(store)).toBe(0);
    expect(hits(store, 1)).toBeGreaterThan(0);
    store.undo();
    expect(hits(store)).toBe(before);
    store.redo();
    expect(hits(store)).toBe(0);
    // Clearing an empty rhythm is not a step to undo.
    store.clearRhythm();
    store.undo();
    expect(hits(store)).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });

  it('puts the starter rhythms back, undoably', () => {
    const store = makeStore();
    const before = store.getState().project.rhythms;
    store.loadStarterRhythms();
    expect(hits(store, 1)).toBe(0);
    expect(hits(store)).toBeGreaterThan(0);
    expect(store.getState().project.rhythmTracks.every((track) => track.length === 0)).toBe(true);
    store.undo();
    expect(store.getState().project.rhythms).toEqual(before);
    expect(store.getState().project.rhythmTracks[0]).toHaveLength(7);
  });

  it('sets the tempo as a click stop and a fine adjustment, inside the machine\'s range', () => {
    const store = makeStore();
    store.setTempo({ coarse: 20 });
    expect(store.getState().project.tempo).toEqual({ coarse: 20, fine: -0.4 });
    store.setTempo({ fine: 0.5 });
    expect(tempoBpm(store.getState().project.tempo)).toBeCloseTo(40 + (20.5 * 260) / 39, 6);
    // A drag reports fractions of a stop; the knob clicks to the nearest one.
    store.setTempo({ coarse: 7.6 });
    expect(store.getState().project.tempo.coarse).toBe(8);
    store.setTempo({ coarse: -3, fine: -9 });
    expect(store.getState().project.tempo).toEqual({ coarse: 0, fine: -1 });
    expect(tempoBpm(store.getState().project.tempo)).toBe(40);
    store.setTempo({ coarse: 99, fine: 9 });
    expect(store.getState().project.tempo).toEqual({ coarse: 39, fine: 1 });
    expect(tempoBpm(store.getState().project.tempo)).toBe(300);
    expect(store.getState().canUndo).toBe(false);
  });

  it('turns the level, accent and master knobs and throws the voice switches', () => {
    const store = makeStore();
    const before = store.getState().project;
    store.setKnob('cymbal', 'level', 0.3);
    store.setKnob('accent', 'level', 1);
    store.setMasterVolume(1.4);
    store.setAlternate('clap', true);
    const { sound } = store.getState().project;
    expect(sound.levels.cymbal).toBe(0.3);
    expect(sound.levels.kick).toBe(before.sound.levels.kick);
    expect(sound.accent).toBe(1);
    expect(sound.master).toBe(1);
    expect(sound.alternates).toEqual({ ...before.sound.alternates, clap: true });
    expect(store.getState().project.rhythms).toBe(before.rhythms);
    expect(store.getState().canUndo).toBe(false);

    // Setting a control to where it already is changes nothing at all.
    const settled = store.getState().project;
    store.setKnob('cymbal', 'level', 0.3);
    store.setMasterVolume(1);
    store.setAlternate('clap', true);
    store.setTempo({ coarse: settled.tempo.coarse });
    expect(store.getState().project).toBe(settled);
  });

  it('turns a sound knob without touching the rhythms or the undo history', () => {
    const store = makeStore();
    const before = store.getState().project;
    store.setKnob('snare', 'snappy', 0.9);
    store.setKnob('snare', 'snappy', 4);
    const after = store.getState().project;
    expect(after.sound.knobs.snare.snappy).toBe(1);
    expect(after.sound.knobs.kick).toBe(before.sound.knobs.kick);
    expect(after.rhythms).toBe(before.rhythms);
    expect(store.getState().canUndo).toBe(false);
  });

  it('keeps knobs and the tempo where they are when a step is undone', () => {
    const store = makeStore();
    store.pressStep(1);
    store.setKnob('kick', 'decay', 0.2);
    store.setTempo({ coarse: 3, fine: 0 });
    store.setName('Kept');
    store.undo();
    const { project } = store.getState();
    expect(isStepOn(project.rhythms[0]!.a.kick, 1)).toBe(false);
    expect(project.sound.knobs.kick.decay).toBe(0.2);
    expect(project.tempo).toEqual({ coarse: 3, fine: 0 });
    expect(project.name).toBe('Kept');
  });

  it('selects a rhythm with a step button outside the write modes', () => {
    const store = makeStore();
    const before = store.getState().project.rhythms;
    store.setMode('pattern_clear');
    expect(store.pressStep(2)).toEqual({ kind: 'rhythm' });
    expect(store.getState().project.panel).toMatchObject({ basicRhythm: 2, writeTarget: 'basic' });
    expect(selectedPattern(store.getState().project)).toBe(patternIndex(2, 'a'));
    // Buttons 13 to 16 are the Intro/Fill-ins, with their own variation switch.
    store.pressStep(13);
    store.setFillVariation('b');
    expect(store.getState().project.panel).toMatchObject({ basicRhythm: 2, fillRhythm: 13, writeTarget: 'fill' });
    expect(editTarget(store.getState().project)).toMatchObject({ rhythm: 13, variation: 'b' });
    expect(selectedPattern(store.getState().project)).toBe(patternIndex(13, 'b'));
    // Choosing a rhythm writes nothing and is not an undo step.
    expect(store.getState().project.rhythms).toBe(before);
    expect(store.getState().canUndo).toBe(false);

    // The write modes then work on the rhythm chosen last.
    store.setMode('write_first');
    store.pressStep(0);
    expect(isStepOn(store.getState().project.rhythms[13]!.b.kick, 0)).toBe(true);
  });

  it('writes the B version, and the 2nd part from its own sixteen steps', () => {
    const store = makeStore();
    const rows = () => store.getState().project.rhythms[0]!;
    const before = rows();
    store.setBasicVariation('b');
    store.pressStep(3);
    expect(isStepOn(rows().b.kick, 3)).toBe(!isStepOn(before.b.kick, 3));
    expect(rows().a).toBe(before.a);

    store.setMode('write_second');
    expect(editTarget(store.getState().project).offset).toBe(16);
    store.pressStep(3);
    expect(isStepOn(rows().b.kick, 19)).toBe(true);
    expect(isStepOn(rows().b.kick, 3)).toBe(!isStepOn(before.b.kick, 3));
    // With the switch on AB the A version is the one on the buttons.
    store.setBasicVariation('ab');
    expect(editTarget(store.getState().project).variation).toBe('a');
  });

  it('clears with CLEAR in pattern clear: one version, or both on AB, and resets the lengths', () => {
    const store = makeStore();
    // Rhythm 4 of the fixture has sixteen and eight steps.
    store.setMode('pattern_clear');
    store.pressStep(3);
    expect(store.getState().project.rhythms[3]).toMatchObject({ firstLength: 16, secondLength: 8, preScale: 2 });
    store.pressClear();
    const cleared = store.getState().project.rhythms[3]!;
    expect(hits(store, 3)).toBe(0);
    expect(cleared).toMatchObject({ firstLength: 16, secondLength: 0, preScale: 2 });
    expect(store.getState().clearArmed).toBe(false);
    store.undo();
    expect(store.getState().project.rhythms[3]).toMatchObject({ secondLength: 8 });

    // Rhythm 1 has both versions written.
    store.pressStep(0);
    store.pressClear();
    expect(countHits(store.getState().project.rhythms[0]!, 'a')).toBe(0);
    expect(countHits(store.getState().project.rhythms[0]!, 'b')).toBeGreaterThan(0);
    store.undo();
    store.setBasicVariation('ab');
    store.pressClear();
    expect(countHits(store.getState().project.rhythms[0]!, 'a')).toBe(0);
    expect(countHits(store.getState().project.rhythms[0]!, 'b')).toBe(0);
  });

  it('stores the pre-scale and sets the last step with CLEAR in a write mode', () => {
    const store = makeStore();
    store.setPreScale(1);
    // Moving the switch alone changes no rhythm.
    expect(store.getState().project.rhythms[0]!.preScale).toBe(3);
    store.pressClear();
    expect(store.getState().project.rhythms[0]!.preScale).toBe(1);
    expect(store.getState().clearArmed).toBe(true);
    // While CLEAR is down a step button sets the last step and writes nothing.
    const row = store.getState().project.rhythms[0]!.a.kick;
    expect(store.pressStep(11)).toEqual({ kind: 'length' });
    expect(store.getState().project.rhythms[0]).toMatchObject({ preScale: 1, firstLength: 12, secondLength: 0 });
    expect(store.getState().project.rhythms[0]!.a.kick).toBe(row);
    expect(store.getState().clearArmed).toBe(false);
    // The next press is an ordinary step again.
    expect(store.pressStep(11).kind).toBe('step');

    // In the 2nd part the same gesture gives the rhythm a 2nd part.
    store.setMode('write_second');
    store.pressClear();
    store.pressStep(3);
    expect(store.getState().project.rhythms[0]).toMatchObject({ firstLength: 12, secondLength: 4 });
    // The lengths belong to both versions, and each change can be undone.
    store.undo();
    expect(store.getState().project.rhythms[0]!.secondLength).toBe(0);
    store.undo();
    store.undo();
    expect(store.getState().project.rhythms[0]!.firstLength).toBe(16);
  });

  it('lets CLEAR come back up without setting anything', () => {
    const store = makeStore();
    store.pressClear();
    store.pressClear();
    expect(store.getState().clearArmed).toBe(false);
    store.pressClear();
    store.releaseClear();
    expect(store.getState().clearArmed).toBe(false);
    store.pressClear();
    store.setMode('manual_play');
    expect(store.getState().clearArmed).toBe(false);
    // Outside pattern clear and the write modes CLEAR does nothing.
    const before = store.getState().project;
    store.pressClear();
    expect(store.getState().project).toBe(before);
    expect(store.getState().clearArmed).toBe(false);
  });

  it('writes a tapped step on the selected track', () => {
    const store = makeStore();
    store.selectTrack('cowbell');
    store.tapStep(9);
    store.tapStep(9);
    expect(isStepOn(store.getState().project.rhythms[0]!.a.cowbell, 9)).toBe(true);
    store.undo();
    expect(isStepOn(store.getState().project.rhythms[0]!.a.cowbell, 9)).toBe(false);
    // A second tap on a step that is already on is not a change.
    expect(store.getState().canUndo).toBe(false);
  });

  it('tracks where playback is', () => {
    const store = makeStore();
    store.setPlaying(true);
    store.setPosition(17, 4);
    expect(store.getState()).toMatchObject({ playing: true, currentStep: 17, currentPattern: 4 });
    store.setPlaying(false);
    expect(store.getState()).toMatchObject({ playing: false, currentStep: -1, currentPattern: -1 });
  });
});

describe('local draft', () => {
  it('saves and restores the active draft', () => {
    const storage = new MemoryStorage();
    expect(loadDraft(storage)).toEqual({ status: 'empty' });
    const store = makeStore();
    store.selectTrack('clap');
    store.pressStep(3);
    store.setTempo({ coarse: 30, fine: 0.25 });
    store.setAlternate('rim_shot', false);
    store.setKnob('accent', 'level', 0.4);
    store.setKnob('cymbal', 'tone', 0.25);
    expect(saveDraft(storage, store.getState().project)).toEqual({ ok: true });

    const loaded = loadDraft(storage);
    expect(loaded.status).toBe('restored');
    if (loaded.status !== 'restored') return;
    expect(loaded.project).toEqual(store.getState().project);
    expect(loaded.changes).toEqual([]);
  });

  it('sets an unreadable draft aside instead of deleting it', () => {
    const storage = new MemoryStorage();
    const broken = serializeProject(loadFixture()).replace('"coarse": 13', '"coarse": "fast"');
    expect(broken).toContain('"fast"');
    storage.items.set(DRAFT_KEY, broken);
    const loaded = loadDraft(storage);
    expect(loaded.status).toBe('unreadable');
    expect(storage.getItem(DRAFT_KEY)).toBeNull();
    expect(storage.getItem(UNREADABLE_DRAFT_KEY)).toBe(broken);
    // The next load starts clean.
    expect(loadDraft(storage)).toEqual({ status: 'empty' });
  });

  it('recovers from truncated JSON', () => {
    const storage = new MemoryStorage();
    storage.items.set(DRAFT_KEY, serializeProject(loadFixture()).slice(0, 200));
    expect(loadDraft(storage).status).toBe('unreadable');
  });

  it('reads a draft left by an earlier version once, and says what changed', () => {
    const storage = new MemoryStorage();
    storage.items.set(LEGACY_DRAFT_KEY, readFileSync(legacyFixturePath, 'utf8'));
    const loaded = loadDraft(storage);
    expect(loaded.status).toBe('restored');
    if (loaded.status !== 'restored') return;
    expect(loaded.changes.length).toBeGreaterThan(0);
    expect(countHits(loaded.project.rhythms[0]!, 'a')).toBe(22);
    // Once saved in the current format, the old draft is not read again.
    saveDraft(storage, { ...loaded.project, name: 'Moved on' });
    const again = loadDraft(storage);
    expect(again.status === 'restored' && again.project.name).toBe('Moved on');
    expect(again.status === 'restored' && again.changes).toEqual([]);
    expect(storage.getItem(LEGACY_DRAFT_KEY)).not.toBeNull();
  });

  it('reports a failed save without throwing', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const result = saveDraft(storage, loadFixture());
    expect(result.ok).toBe(false);
  });
});

describe('project import', () => {
  it('reads a valid file', async () => {
    const result = await readProjectFile(new Blob([readFileSync(fixturePath)]));
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid file and leaves the draft untouched', async () => {
    const store = makeStore();
    const before = store.getState().project;
    for (const contents of [
      '{ nope',
      '{"format":"boombapbot.project","schemaVersion":1}',
      '{"format":"boombapbot.project","schemaVersion":2}',
      '{"format":"boombapbot.project","schemaVersion":3}',
      'RIFF....WAVE',
    ]) {
      const result = await readProjectFile(new Blob([contents]));
      expect(result.ok).toBe(false);
      if (result.ok) store.replaceProject(result.project);
    }
    expect(store.getState().project).toBe(before);
  });

  it('replaces the whole project on a valid import and can undo it', async () => {
    const store = makeStore();
    store.setKnob('kick', 'decay', 0.1);
    store.setName('Mine');
    store.clearRhythm();
    const result = await readProjectFile(new Blob([readFileSync(legacyFixturePath)]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.length).toBeGreaterThan(0);
    store.replaceProject(result.project);
    expect(hits(store)).toBe(22);
    expect(store.getState().project.sound.knobs.kick.decay).toBe(0.5);
    // Undo brings back the knobs and the name too, not only the rhythms.
    store.undo();
    expect(hits(store)).toBe(0);
    expect(store.getState().project.sound.knobs.kick.decay).toBe(0.1);
    expect(store.getState().project.name).toBe('Mine');
    store.redo();
    expect(hits(store)).toBe(22);
    expect(store.getState().project.name).toBe(result.project.name);
  });

  it('names export files safely', () => {
    const project = { ...loadFixture(), name: '  My  Beat / v2: "final"  ' };
    expect(exportBaseName(project)).toBe('my-beat-v2-final');
    expect(projectFileName(project)).toBe('my-beat-v2-final.boombapbot.json');
    expect(exportBaseName({ ...project, name: '///' })).toBe('boombapbot-beat');
  });
});

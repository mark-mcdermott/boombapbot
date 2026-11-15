import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VELOCITY, countHits, findLane, serializeProject } from '@boombapbot/contracts';
import {
  DRAFT_KEY,
  UNREADABLE_DRAFT_KEY,
  loadDraft,
  saveDraft,
  type KeyValueStorage,
} from '../src/state/draft-storage';
import { exportBaseName, projectFileName, readProjectFile } from '../src/state/project-io';
import { EditorStore } from '../src/state/store';
import { fixturePath, loadFixture } from './helpers';

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
    // Each action is a second apart, so nothing coalesces unless a test wants it.
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, (tick += 1))),
    newId: () => 'test-id',
  });
}

describe('editor store', () => {
  it('toggles steps and edits velocity', () => {
    const store = makeStore();
    expect(store.toggleStep('open_hat', 6)).toBe(DEFAULT_VELOCITY);
    expect(findLane(store.getState().project.pattern, 'open_hat').steps[6]).toBe(DEFAULT_VELOCITY);
    store.setVelocity('open_hat', 6, 300);
    expect(findLane(store.getState().project.pattern, 'open_hat').steps[6]).toBe(127);
    expect(store.toggleStep('open_hat', 6)).toBe(0);
    expect(findLane(store.getState().project.pattern, 'open_hat').steps[6]).toBe(0);
  });

  it('keeps rhythm, velocity, tempo and swing across a kit change', () => {
    const store = makeStore();
    const before = store.getState().project;
    for (const kit of ['606', '707', '909', '808'] as const) {
      store.setKit(kit);
      const after = store.getState().project;
      expect(after.kit.id).toBe(kit);
      expect(after.pattern).toBe(before.pattern); // not even copied
      expect(after.bpm).toBe(before.bpm);
      expect(after.swing).toBe(before.swing);
      expect(after.pattern.lanes.map((lane) => lane.id)).toEqual(before.pattern.lanes.map((lane) => lane.id));
    }
  });

  it('clears the pattern and can undo it', () => {
    const store = makeStore();
    const hits = countHits(store.getState().project.pattern);
    store.clearPattern();
    expect(countHits(store.getState().project.pattern)).toBe(0);
    expect(store.getState().canUndo).toBe(true);
    store.undo();
    expect(countHits(store.getState().project.pattern)).toBe(hits);
    store.redo();
    expect(countHits(store.getState().project.pattern)).toBe(0);
    store.loadStarterBeat();
    expect(countHits(store.getState().project.pattern)).toBeGreaterThan(10);
  });

  it('clamps tempo and swing', () => {
    const store = makeStore();
    store.setBpm(1000);
    expect(store.getState().project.bpm).toBe(240);
    store.setBpm(1);
    expect(store.getState().project.bpm).toBe(40);
    store.setSwing(99);
    expect(store.getState().project.swing).toBe(75);
    store.setSwing(Number.NaN);
    expect(store.getState().project.swing).toBe(50);
  });

  it('collapses a slider drag into one undo step', () => {
    const start = Date.UTC(2026, 0, 1);
    let now = start;
    const store = new EditorStore({ project: loadFixture(), now: () => new Date(now) });
    for (const bpm of [125, 126, 127, 128]) {
      now += 50;
      store.setBpm(bpm);
    }
    expect(store.getState().project.bpm).toBe(128);
    store.undo();
    expect(store.getState().project.bpm).toBe(124);
    expect(store.getState().canUndo).toBe(false);
  });

  it('turns a sound knob without touching the beat or its undo history', () => {
    const store = makeStore();
    const before = store.getState().project;
    store.setKnob('kick', 'decay', 0.8);
    expect(store.getState().sound.kick).toEqual({ tune: 0.5, tone: 0.5, decay: 0.8, snappy: 0.5 });
    expect(store.getState().sound.snare.decay).toBe(0.5);
    store.setKnob('kick', 'decay', 4);
    expect(store.getState().sound.kick.decay).toBe(1);
    store.setKnob('kick', 'decay', -1);
    expect(store.getState().sound.kick.decay).toBe(0);
    expect(store.getState().project).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });

  it('shares selection between editors', () => {
    const store = makeStore();
    store.select('snare', 4);
    store.setMode('hardware');
    expect(store.getState().selectedRole).toBe('snare');
    store.toggleStep('snare', 9);
    store.setMode('modern');
    expect(findLane(store.getState().project.pattern, 'snare').steps[9]).toBe(DEFAULT_VELOCITY);
  });
});

describe('local draft', () => {
  it('saves and restores the active draft', () => {
    const storage = new MemoryStorage();
    expect(loadDraft(storage)).toEqual({ status: 'empty' });
    const store = makeStore();
    store.toggleStep('clap', 3);
    store.setBpm(131);
    store.setKit('909');
    expect(saveDraft(storage, store.getState().project)).toEqual({ ok: true });

    const loaded = loadDraft(storage);
    expect(loaded.status).toBe('restored');
    if (loaded.status !== 'restored') return;
    expect(loaded.project).toEqual(store.getState().project);
  });

  it('sets an unreadable draft aside instead of deleting it', () => {
    const storage = new MemoryStorage();
    const broken = serializeProject(loadFixture()).replace('"bpm": 124', '"bpm": "fast"');
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
    for (const contents of ['{ nope', '{"format":"boombapbot.project","schemaVersion":1}', 'RIFF....WAVE']) {
      const result = await readProjectFile(new Blob([contents]));
      expect(result.ok).toBe(false);
      if (result.ok) store.replaceProject(result.project);
    }
    expect(store.getState().project).toBe(before);
  });

  it('replaces the beat on a valid import and can undo it', async () => {
    const store = makeStore();
    store.clearPattern();
    const result = await readProjectFile(new Blob([readFileSync(fixturePath)]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    store.replaceProject(result.project);
    expect(countHits(store.getState().project.pattern)).toBe(22);
    store.undo();
    expect(countHits(store.getState().project.pattern)).toBe(0);
  });

  it('names export files safely', () => {
    const project = { ...loadFixture(), name: '  My  Beat / v2: "final"  ' };
    expect(exportBaseName(project)).toBe('my-beat-v2-final');
    expect(projectFileName(project)).toBe('my-beat-v2-final.boombapbot.json');
    expect(exportBaseName({ ...project, name: '///' })).toBe('boombapbot-beat');
  });
});

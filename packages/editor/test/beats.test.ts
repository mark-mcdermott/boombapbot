import { describe, expect, it } from 'vitest';
import { BEAT_LINKS_KEY, BeatLinks } from '../src/account/beat-links';
import { EditorRuntime } from '../src/runtime';
import type { KeyValueStorage } from '../src/state/draft-storage';
import { loadFixture } from './helpers';

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

const SEEN = '2026-11-16T12:00:00.000Z';

describe('what this device remembers about saved beats', () => {
  it('remembers which saved beat a project goes with, and when that copy was saved', () => {
    const links = new BeatLinks(new MemoryStorage());
    expect(links.get('account', 'project')).toBeNull();
    links.set('account', 'project', { beat: 'beat-1', seen: SEEN });
    expect(links.get('account', 'project')).toEqual({ beat: 'beat-1', seen: SEEN });
    // A later save moves it on.
    links.set('account', 'project', { beat: 'beat-1', seen: '2026-11-16T13:00:00.000Z' });
    expect(links.get('account', 'project')?.seen).toBe('2026-11-16T13:00:00.000Z');
  });

  it('keeps each account apart', () => {
    const links = new BeatLinks(new MemoryStorage());
    links.set('mine', 'project', { beat: 'beat-1', seen: SEEN });
    expect(links.get('yours', 'project')).toBeNull();
    links.keepOnly('yours', []);
    expect(links.get('mine', 'project')).not.toBeNull();
  });

  it('lasts across visits', () => {
    const storage = new MemoryStorage();
    new BeatLinks(storage).set('account', 'project', { beat: 'beat-1', seen: SEEN });
    expect(new BeatLinks(storage).get('account', 'project')).toEqual({ beat: 'beat-1', seen: SEEN });
  });

  it('forgets beats the account no longer holds', () => {
    const storage = new MemoryStorage();
    const links = new BeatLinks(storage);
    links.set('account', 'kept', { beat: 'beat-1', seen: SEEN });
    links.set('account', 'gone', { beat: 'beat-2', seen: SEEN });
    links.keepOnly('account', ['beat-1', 'beat-3']);
    expect(links.get('account', 'kept')).not.toBeNull();
    expect(links.get('account', 'gone')).toBeNull();
    expect(new BeatLinks(storage).get('account', 'gone')).toBeNull();
  });

  it('reads anything it does not recognise as nothing remembered', () => {
    for (const text of ['not json', '[]', '"text"', '{"account":7}', '{"account":{"project":{"beat":1}}}']) {
      const storage = new MemoryStorage();
      storage.setItem(BEAT_LINKS_KEY, text);
      expect(new BeatLinks(storage).get('account', 'project'), text).toBeNull();
    }
    const storage = new MemoryStorage();
    storage.setItem(BEAT_LINKS_KEY, '{"account":{"good":{"beat":"b","seen":"2026-11-16T12:00:00Z"},"bad":{"beat":"b","seen":"soon"}}}');
    const links = new BeatLinks(storage);
    expect(links.get('account', 'good')).not.toBeNull();
    expect(links.get('account', 'bad')).toBeNull();
  });

  it('still works for the visit when the browser will not store anything', () => {
    const blocked = new MemoryStorage();
    blocked.failWrites = true;
    for (const links of [new BeatLinks(null), new BeatLinks(blocked)]) {
      links.set('account', 'project', { beat: 'beat-1', seen: SEEN });
      expect(links.get('account', 'project')).toEqual({ beat: 'beat-1', seen: SEEN });
    }
  });
});

describe('loading a saved beat onto the machine', () => {
  const saved = () => ({ ...loadFixture(), id: 'from-the-account', name: 'From the account' });

  it('replaces the beat as one undo step, as an import does', () => {
    const machine = new EditorRuntime({ baseUrl: '/', storage: null });
    const before = machine.store.getState().project;

    const loaded = machine.loadSavedBeat(JSON.parse(JSON.stringify(saved())));
    expect(loaded?.id).toBe('from-the-account');
    expect(machine.store.getState().project.name).toBe('From the account');
    expect(machine.store.getState().notice).toMatchObject({
      kind: 'info',
      message: 'Loaded “From the account” from your account. Undo brings back the previous beat.',
    });

    machine.store.undo();
    expect(machine.store.getState().project).toEqual(before);
    expect(machine.store.getState().canUndo).toBe(false);
  });

  it('leaves the beat alone when what came back is not a project', () => {
    const machine = new EditorRuntime({ baseUrl: '/', storage: null });
    const before = machine.store.getState().project;
    for (const broken of [null, 'a beat', {}, { ...saved(), rhythms: [] }, { ...saved(), schemaVersion: 99 }]) {
      expect(machine.loadSavedBeat(broken)).toBeNull();
      expect(machine.store.getState().project).toBe(before);
      expect(machine.store.getState().canUndo).toBe(false);
      expect(machine.store.getState().notice).toMatchObject({
        kind: 'error',
        message: 'That saved beat could not be read. Your current beat is unchanged.',
      });
    }
  });
});

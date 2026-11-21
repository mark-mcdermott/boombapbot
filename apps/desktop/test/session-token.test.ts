import type { KeyValueStorage } from '@boombapbot/editor';
import { describe, expect, it, vi } from 'vitest';
import { openTokenStore } from '../src/session-token';

const KEY = 'boombapbot.session-token';

function fakeStorage(kept: Record<string, string> = {}): KeyValueStorage & { kept: Map<string, string> } {
  const held = new Map(Object.entries(kept));
  return {
    kept: held,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
  };
}

const refusing: KeyValueStorage = {
  getItem: () => {
    throw new Error('no reading');
  },
  setItem: () => {
    throw new Error('no writing');
  },
  removeItem: () => {
    throw new Error('no removing');
  },
};

describe('the token that says who is logged in', () => {
  it('is the one kept from the last time the app was open', () => {
    expect(openTokenStore(fakeStorage({ [KEY]: 'kept-token' })).get()).toBe('kept-token');
  });

  it('is nobody when none is kept', () => {
    expect(openTokenStore(fakeStorage()).get()).toBeNull();
  });

  it('is kept when it changes and forgotten on logging out', () => {
    const storage = fakeStorage();
    const store = openTokenStore(storage);
    store.set('new-token');
    expect(store.get()).toBe('new-token');
    expect(storage.kept.get(KEY)).toBe('new-token');
    store.set(null);
    expect(store.get()).toBeNull();
    expect(storage.kept.has(KEY)).toBe(false);
  });

  it('lasts while the app is open when there is nowhere to keep it', () => {
    const store = openTokenStore(null);
    store.set('new-token');
    expect(store.get()).toBe('new-token');
  });

  it('lasts while the app is open when the store refuses, and says so', () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = openTokenStore(refusing);
    expect(store.get()).toBeNull();
    store.set('new-token');
    expect(store.get()).toBe('new-token');
    expect(said).toHaveBeenCalledTimes(2);
    said.mockRestore();
  });
});

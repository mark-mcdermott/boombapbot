import { describe, expect, it, vi } from 'vitest';
import { openTokenStore, type TokenKeeper } from '../src/session-token';

function fakeKeeper(kept: string | null = null): TokenKeeper & { kept(): string | null } {
  let value = kept;
  return {
    kept: () => value,
    get: async () => ({ value }),
    set: async (options) => {
      value = options.value;
    },
    remove: async () => {
      value = null;
    },
  };
}

describe('the token that says who is logged in', () => {
  it('is read from the device once and answered at once after', async () => {
    const store = await openTokenStore(fakeKeeper('kept-token'));
    expect(store.get()).toBe('kept-token');
  });

  it('is nobody when the device has none', async () => {
    expect((await openTokenStore(fakeKeeper())).get()).toBeNull();
  });

  it('is answered straight away when it changes, and written to the device', async () => {
    const keeper = fakeKeeper();
    const store = await openTokenStore(keeper);
    store.set('new-token');
    expect(store.get()).toBe('new-token');
    await vi.waitFor(() => expect(keeper.kept()).toBe('new-token'));
    store.set(null);
    expect(store.get()).toBeNull();
    await vi.waitFor(() => expect(keeper.kept()).toBeNull());
  });

  it('lasts in memory when the device store fails', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken: TokenKeeper = {
      get: () => Promise.reject(new Error('no store')),
      set: () => Promise.reject(new Error('no store')),
      remove: () => Promise.reject(new Error('no store')),
    };
    const store = await openTokenStore(broken);
    expect(store.get()).toBeNull();
    store.set('new-token');
    expect(store.get()).toBe('new-token');
    await vi.waitFor(() => expect(quiet).toHaveBeenCalledTimes(2));
    quiet.mockRestore();
  });
});

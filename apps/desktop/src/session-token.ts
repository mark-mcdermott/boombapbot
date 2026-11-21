import type { KeyValueStorage, TokenStore } from '@boombapbot/editor';

const KEY = 'boombapbot.session-token';

/**
 * The token that says who is logged in, kept where the web view keeps the
 * draft. It is answered from memory, so a store that cannot be read or
 * written, or no store at all, leaves a log-in that lasts as long as the app
 * stays open.
 */
export function openTokenStore(storage: KeyValueStorage | null): TokenStore {
  const failed = (error: unknown) => console.error('The log-in could not be kept, so it lasts until the app is closed.', error);
  const attempt = <Result>(action: (storage: KeyValueStorage) => Result): Result | null => {
    if (!storage) return null;
    try {
      return action(storage);
    } catch (error) {
      failed(error);
      return null;
    }
  };
  let token = attempt((kept) => kept.getItem(KEY));
  return {
    get: () => token,
    set(next) {
      token = next;
      attempt((kept) => (next === null ? kept.removeItem(KEY) : kept.setItem(KEY, next)));
    },
  };
}

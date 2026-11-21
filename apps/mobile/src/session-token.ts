import type { TokenStore } from '@boombapbot/editor';
import type { DeviceStore } from './device-storage';

/** The part of the device's store the token is kept with. */
export type TokenKeeper = Pick<DeviceStore, 'get' | 'set' | 'remove'>;

const KEY = 'boombapbot.session-token';

/**
 * The token that says who is logged in, read from the device's store once
 * so it can be answered at once after. A change is answered from memory
 * straight away and written behind; if the store cannot be read or written
 * the log-in lasts as long as the app stays open.
 */
export async function openTokenStore(keeper: TokenKeeper): Promise<TokenStore> {
  const failed = (error: unknown) => console.error('The device store could not keep the log-in, so it lasts until the app is closed.', error);
  let token = await keeper.get({ key: KEY }).then(
    ({ value }) => value,
    (error: unknown) => {
      failed(error);
      return null;
    },
  );
  return {
    get: () => token,
    set(next) {
      token = next;
      void (next === null ? keeper.remove({ key: KEY }) : keeper.set({ key: KEY, value: next })).catch(failed);
    },
  };
}

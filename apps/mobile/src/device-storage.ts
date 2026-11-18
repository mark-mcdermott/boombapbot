import type { KeyValueStorage } from '@boombapbot/editor';

/** The part of a device's key-value store this needs: Capacitor's Preferences, or a fake in tests. */
export interface DeviceStore {
  keys(): Promise<{ keys: string[] }>;
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}

/**
 * The device's own store behind the synchronous storage the editor asks for.
 * Everything in it is read once, before the editor mounts. After that a read
 * is answered from memory and a write follows to the device: one at a time
 * for each key, and always ending on the newest value.
 */
export async function openDeviceStorage(device: DeviceStore): Promise<KeyValueStorage> {
  const held = new Map<string, string>();
  const { keys } = await device.keys();
  await Promise.all(
    keys.map(async (key) => {
      const { value } = await device.get({ key });
      if (value !== null) held.set(key, value);
    }),
  );

  const writing = new Set<string>();
  const behind = new Set<string>();
  let refused: Error | null = null;

  const send = (key: string): void => {
    if (writing.has(key)) {
      behind.add(key);
      return;
    }
    writing.add(key);
    const value = held.get(key);
    const sent = value === undefined ? device.remove({ key }) : device.set({ key, value });
    sent
      .then(
        () => {
          refused = null;
        },
        (error: unknown) => {
          refused = error instanceof Error ? error : new Error(String(error));
        },
      )
      .finally(() => {
        writing.delete(key);
        if (behind.delete(key)) send(key);
      });
  };

  // The device answers later, so a write it refused is reported by the next one.
  const follow = (key: string): void => {
    const earlier = refused;
    refused = null;
    send(key);
    if (earlier) throw earlier;
  };

  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value);
      follow(key);
    },
    removeItem: (key) => {
      held.delete(key);
      follow(key);
    },
  };
}

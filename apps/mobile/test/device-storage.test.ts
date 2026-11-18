import { describe, expect, it } from 'vitest';
import { openDeviceStorage, type DeviceStore } from '../src/device-storage';

/** A device store whose writes wait until the test lets them through. */
function fakeDevice(initial: Record<string, string> = {}) {
  const kept = new Map(Object.entries(initial));
  const waiting: Array<() => void> = [];
  const writes: string[] = [];
  let failing = false;

  const later = (apply: () => void) =>
    new Promise<void>((resolve, reject) => {
      waiting.push(() => {
        if (failing) {
          reject(new Error('the device is full'));
          return;
        }
        apply();
        resolve();
      });
    });

  const device: DeviceStore = {
    keys: async () => ({ keys: [...kept.keys()] }),
    get: async ({ key }) => ({ value: kept.get(key) ?? null }),
    set: ({ key, value }) => {
      writes.push(`${key}=${value}`);
      return later(() => kept.set(key, value));
    },
    remove: ({ key }) => {
      writes.push(`${key} removed`);
      return later(() => kept.delete(key));
    },
  };

  return {
    device,
    kept,
    writes,
    fail(on: boolean) {
      failing = on;
    },
    /** Lets every write through, including the ones that follow from them. */
    async settle() {
      while (waiting.length > 0) {
        waiting.shift()?.();
        await new Promise((resolve) => setTimeout(resolve));
      }
    },
  };
}

describe('the device store behind the editor', () => {
  it('answers reads from what the device held when it was opened', async () => {
    const { device } = fakeDevice({ draft: '{"name":"kept"}' });
    const storage = await openDeviceStorage(device);
    expect(storage.getItem('draft')).toBe('{"name":"kept"}');
    expect(storage.getItem('nothing')).toBeNull();
  });

  it('answers a read with what was just written, before the device has it', async () => {
    const fake = fakeDevice();
    const storage = await openDeviceStorage(fake.device);
    storage.setItem('draft', 'one');
    expect(storage.getItem('draft')).toBe('one');
    expect(fake.kept.has('draft')).toBe(false);
    await fake.settle();
    expect(fake.kept.get('draft')).toBe('one');
  });

  it('writes one at a time and ends on the newest value', async () => {
    const fake = fakeDevice();
    const storage = await openDeviceStorage(fake.device);
    for (const value of ['one', 'two', 'three', 'four']) storage.setItem('draft', value);
    await fake.settle();
    expect(fake.writes).toEqual(['draft=one', 'draft=four']);
    expect(fake.kept.get('draft')).toBe('four');
  });

  it('removes from the device what the editor removes', async () => {
    const fake = fakeDevice({ draft: 'one' });
    const storage = await openDeviceStorage(fake.device);
    storage.removeItem('draft');
    expect(storage.getItem('draft')).toBeNull();
    await fake.settle();
    expect(fake.kept.has('draft')).toBe(false);
  });

  it('a second opening reads what the first one wrote', async () => {
    const fake = fakeDevice();
    const first = await openDeviceStorage(fake.device);
    first.setItem('draft', 'kept across a relaunch');
    await fake.settle();
    const second = await openDeviceStorage(fake.device);
    expect(second.getItem('draft')).toBe('kept across a relaunch');
  });

  it('reports a write the device refused on the next write, then carries on', async () => {
    const fake = fakeDevice();
    const storage = await openDeviceStorage(fake.device);
    fake.fail(true);
    storage.setItem('draft', 'one');
    await fake.settle();
    fake.fail(false);
    expect(() => storage.setItem('draft', 'two')).toThrow('the device is full');
    await fake.settle();
    expect(fake.kept.get('draft')).toBe('two');
    expect(() => storage.setItem('draft', 'three')).not.toThrow();
  });
});

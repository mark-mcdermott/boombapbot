import { describe, expect, it } from 'vitest';
import { shareThrough, type DeviceFiles, type ShareSheet } from '../src/share-file';

type Written = Parameters<DeviceFiles['write']>[0];

function fakeDevice(answer: () => Promise<unknown> = async () => ({})) {
  const written: Written[] = [];
  const shared: Array<{ title: string; files: string[] }> = [];
  const files: DeviceFiles = {
    write: async (file) => {
      written.push(file);
      return { uri: `file:///cache/${file.path}` };
    },
  };
  const sheet: ShareSheet = {
    share: (options) => {
      shared.push(options);
      return answer();
    },
  };
  return { written, shared, save: shareThrough(files, sheet) };
}

describe('an export handed to the share sheet', () => {
  it('writes bytes as base64 and shares the file by its name', async () => {
    const device = fakeDevice();
    const data = new Uint8Array([82, 73, 70, 70, 0, 255, 128, 1]);
    expect(await device.save({ name: 'starter-beat.wav', data, type: 'audio/wav' })).toBe(true);
    expect(device.written).toEqual([{ path: 'exports/starter-beat.wav', data: 'UklGRgD/gAE=', as: 'base64' }]);
    expect(device.shared).toEqual([{ title: 'starter-beat.wav', files: ['file:///cache/exports/starter-beat.wav'] }]);
  });

  it('writes a long file whole', async () => {
    const device = fakeDevice();
    const data = new Uint8Array(200_000).map((_, index) => index % 251);
    await device.save({ name: 'long.wav', data, type: 'audio/wav' });
    const back = Uint8Array.from(atob(device.written[0]?.data ?? ''), (char) => char.charCodeAt(0));
    expect(back).toEqual(data);
  });

  it('writes text as text', async () => {
    const device = fakeDevice();
    await device.save({ name: 'beat.boombapbot.json', data: '{"name":"РИТМ"}', type: 'application/json' });
    expect(device.written[0]).toEqual({ path: 'exports/beat.boombapbot.json', data: '{"name":"РИТМ"}', as: 'text' });
  });

  it('says so when the person closes the sheet without choosing', async () => {
    const device = fakeDevice(() => Promise.reject(new Error('Share canceled')));
    expect(await device.save({ name: 'beat.mid', data: new Uint8Array([1]), type: 'audio/midi' })).toBe(false);
  });

  it('passes on a share that failed', async () => {
    const device = fakeDevice(() => Promise.reject(new Error('The sheet could not be shown')));
    await expect(device.save({ name: 'beat.mid', data: new Uint8Array([1]), type: 'audio/midi' })).rejects.toThrow(
      'The sheet could not be shown',
    );
  });
});

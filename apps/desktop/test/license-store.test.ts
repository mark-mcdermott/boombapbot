import { readFileSync } from 'node:fs';
import { LICENSE_FILE_KEY, type KeyValueStorage } from '@boombapbot/editor';
import { describe, expect, it, vi } from 'vitest';
import { openLicenseStore } from '../src/license-store';

const FILE = 'boombapbot-license.eyJ2ZXJzaW9uIjoxfQ.c2lnbmF0dXJl';
const SOURCE_KEY = 'boombapbot.license.source.v1';

function webView(kept: Record<string, string> = {}): KeyValueStorage & { kept: Map<string, string> } {
  const held = new Map(Object.entries(kept));
  return {
    kept: held,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
  };
}

/** The app's side: a disk holding one file or none, and every command it was asked for. */
function app(onDisk: string | null = null, broken = false) {
  const disk = { file: onDisk };
  const invoked: string[] = [];
  const invoke = async <Answer>(command: string, args?: Record<string, unknown> | Uint8Array): Promise<Answer> => {
    invoked.push(command);
    if (broken) throw new Error('the disk said no');
    if (command === 'license_write') disk.file = String((args as { file: string }).file);
    if (command === 'license_remove') disk.file = null;
    return (command === 'license_read' ? disk.file : undefined) as Answer;
  };
  return { disk, invoked, invoke };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('where the app keeps its license file', () => {
  it('is read from the disk once, as the app opens', async () => {
    const { invoke, invoked } = app(FILE);
    const store = await openLicenseStore(invoke, webView());
    expect(store.getItem(LICENSE_FILE_KEY)).toBe(FILE);
    expect(store.getItem(LICENSE_FILE_KEY)).toBe(FILE);
    expect(invoked).toEqual(['license_read']);
  });

  it('is written to the disk when a file is kept, and removed from it when the device is locked', async () => {
    const { invoke, disk } = app();
    const store = await openLicenseStore(invoke, webView());
    expect(store.getItem(LICENSE_FILE_KEY)).toBeNull();
    store.setItem(LICENSE_FILE_KEY, FILE);
    expect(store.getItem(LICENSE_FILE_KEY)).toBe(FILE);
    await settled();
    expect(disk.file).toBe(FILE);
    store.removeItem(LICENSE_FILE_KEY);
    expect(store.getItem(LICENSE_FILE_KEY)).toBeNull();
    await settled();
    expect(disk.file).toBeNull();
  });

  it('keeps how the device came by its file in the web view, and only the file on the disk', async () => {
    const { invoke, invoked } = app(FILE);
    const view = webView();
    const store = await openLicenseStore(invoke, view);
    store.setItem(SOURCE_KEY, 'key');
    expect(store.getItem(SOURCE_KEY)).toBe('key');
    expect(view.kept.get(SOURCE_KEY)).toBe('key');
    store.removeItem(SOURCE_KEY);
    expect(store.getItem(SOURCE_KEY)).toBeNull();
    expect(invoked).toEqual(['license_read']);
  });

  it('moves a file an earlier version left in the web view onto the disk', async () => {
    const { invoke, disk } = app();
    const store = await openLicenseStore(invoke, webView({ [LICENSE_FILE_KEY]: FILE }));
    expect(store.getItem(LICENSE_FILE_KEY)).toBe(FILE);
    await settled();
    expect(disk.file).toBe(FILE);
  });

  it('holds with the web view alone when the disk cannot be read or written', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { invoke } = app(null, true);
    const view = webView({ [LICENSE_FILE_KEY]: FILE });
    const store = await openLicenseStore(invoke, view);
    expect(store.getItem(LICENSE_FILE_KEY)).toBe(FILE);
    store.removeItem(LICENSE_FILE_KEY);
    await settled();
    expect(store.getItem(LICENSE_FILE_KEY)).toBeNull();
    expect(view.kept.has(LICENSE_FILE_KEY)).toBe(false);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('works with no web view storage at all', async () => {
    const { invoke, disk } = app();
    const store = await openLicenseStore(invoke, null);
    store.setItem(LICENSE_FILE_KEY, FILE);
    await settled();
    expect(disk.file).toBe(FILE);
    expect(store.getItem(SOURCE_KEY)).toBeNull();
  });

  it('asks only for commands the app has', async () => {
    const appSource = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
    const { invoke, invoked } = app();
    const store = await openLicenseStore(invoke, null);
    store.setItem(LICENSE_FILE_KEY, FILE);
    store.removeItem(LICENSE_FILE_KEY);
    await settled();
    for (const command of invoked) expect(appSource).toContain(`license::${command},`);
  });
});

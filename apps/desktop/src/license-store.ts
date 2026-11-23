import { LICENSE_FILE_KEY, type KeyValueStorage } from '@boombapbot/editor';
import type { TauriCalls } from './tauri-engine';

/**
 * Where the app keeps its license file: on the machine's disk, in the one
 * place the plugin reads too, so unlocking the app unlocks the plugin (see
 * docs/license-file.md). The file is read once, before the editor mounts, and
 * answered from memory after; keeping one or removing it follows to the disk.
 * Whatever else is kept beside the file, such as how the device came by it,
 * stays in the web view's storage.
 *
 * A file an earlier version left in the web view is moved to the disk. If
 * the disk cannot be read or written the web view's own copy is what holds,
 * and the plugin stays as it was.
 */
export async function openLicenseStore(
  invoke: TauriCalls['invoke'],
  webView: KeyValueStorage | null,
): Promise<KeyValueStorage> {
  const failed = (what: string) => (error: unknown) =>
    console.error(`The license file could not be ${what} where the plugin reads it.`, error);
  const beside = <Result>(action: (storage: KeyValueStorage) => Result): Result | null => {
    try {
      return webView ? action(webView) : null;
    } catch {
      return null;
    }
  };

  const write = (file: string) => invoke<void>('license_write', { file }).catch(failed('kept'));
  const onDisk = await invoke<string | null>('license_read').catch((error: unknown) => {
    failed('read')(error);
    return null;
  });
  const left = beside((storage) => storage.getItem(LICENSE_FILE_KEY));
  let file = onDisk ?? left;
  if (!onDisk && left) void write(left);

  return {
    getItem: (key) => (key === LICENSE_FILE_KEY ? file : beside((storage) => storage.getItem(key))),
    setItem(key, value) {
      beside((storage) => storage.setItem(key, value));
      if (key !== LICENSE_FILE_KEY) return;
      file = value;
      void write(value);
    },
    removeItem(key) {
      beside((storage) => storage.removeItem(key));
      if (key !== LICENSE_FILE_KEY) return;
      file = null;
      void invoke<void>('license_remove').catch(failed('removed'));
    },
  };
}

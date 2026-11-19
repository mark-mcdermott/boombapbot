import type { ExportedFile, SaveFile } from '@boombapbot/editor';
import type { TauriCalls } from './tauri-engine';

/**
 * A web view inside an app ignores a download, so an exported file goes
 * through the app: it asks the person where to keep the file, and writes
 * the bytes there. The page names the file and never a place on the disk.
 */
export function saveThroughApp(invoke: TauriCalls['invoke']): SaveFile {
  return async ({ name, data }: ExportedFile) => {
    if (!(await invoke<boolean>('export_ask', { name }))) return false;
    await invoke<void>('export_write', typeof data === 'string' ? new TextEncoder().encode(data) : data);
    return true;
  };
}

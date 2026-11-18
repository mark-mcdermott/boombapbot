import type { ExportedFile, SaveFile } from '@boombapbot/editor';

/** Somewhere on the device a file can be written and then shared from. A fake in tests. */
export interface DeviceFiles {
  /** Writes text as it is, or bytes given as base64, and says where the file now is. */
  write(file: { path: string; data: string; as: 'text' | 'base64' }): Promise<{ uri: string }>;
}

/** The part of the device's share sheet this needs: Capacitor's Share, or a fake in tests. */
export interface ShareSheet {
  share(options: { title: string; files: string[] }): Promise<unknown>;
}

/** What both phones' share sheets answer when the person closes them without choosing. */
const TURNED_DOWN = 'Share canceled';

const EXPORTS_FOLDER = 'exports';

/** Bytes as base64, a piece at a time so a long WAV does not overrun the call stack. */
function base64(bytes: Uint8Array): string {
  const PIECE = 0x8000;
  let binary = '';
  for (let start = 0; start < bytes.length; start += PIECE) {
    binary += String.fromCharCode(...bytes.subarray(start, start + PIECE));
  }
  return btoa(binary);
}

/**
 * An app's web view ignores a download, so an exported file is written to
 * the device and handed to the share sheet: from there the person saves it
 * to their files or sends it to another app.
 */
export function shareThrough(files: DeviceFiles, sheet: ShareSheet): SaveFile {
  return async ({ name, data }: ExportedFile) => {
    const path = `${EXPORTS_FOLDER}/${name}`;
    const { uri } =
      typeof data === 'string'
        ? await files.write({ path, data, as: 'text' })
        : await files.write({ path, data: base64(data), as: 'base64' });
    try {
      await sheet.share({ title: name, files: [uri] });
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === TURNED_DOWN) return false;
      throw error;
    }
  };
}

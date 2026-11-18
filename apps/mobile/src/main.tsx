import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import { BoombapbotEditor, type KeyValueStorage } from '@boombapbot/editor';
import { machine } from '@boombapbot/machine-ritm12';
import { openDeviceStorage } from './device-storage';
import { shareThrough, type DeviceFiles } from './share-file';
import './styles.css';

interface AudioSessionNavigator {
  audioSession?: { type: string };
}

/**
 * Sound made with Web Audio counts as ambient on an iPhone, which the ringer
 * switch silences. A drum machine is for playing, so it asks to be heard.
 */
function askToBeHeard(): void {
  const session = (navigator as Navigator & AudioSessionNavigator).audioSession;
  if (session) session.type = 'playback';
}

/**
 * The device's own store for the draft: a web view's storage can be cleared
 * by the system. If it cannot be opened the web view's storage is used, which
 * is what `undefined` asks the editor for.
 */
async function draftStorage(): Promise<KeyValueStorage | undefined> {
  try {
    return await openDeviceStorage(Preferences);
  } catch (error) {
    console.error('The device store could not be opened, so the draft is kept in the web view.', error);
    return undefined;
  }
}

/** Under the machine there is only its settings: the app has no site behind it. */
function tools(settings: ReactNode): ReactNode {
  return (
    <footer className="sb-footer">
      <div className="sb-footer-icons sb-footer-tools">{settings}</div>
    </footer>
  );
}

/** Exports are written where the device keeps what it may clear: the share sheet takes its own copy. */
const exportFiles: DeviceFiles = {
  write: ({ path, data, as }) =>
    Filesystem.writeFile({
      path,
      data,
      directory: Directory.Cache,
      encoding: as === 'text' ? Encoding.UTF8 : undefined,
      recursive: true,
    }),
};

/** On a phone an export goes to the share sheet. In a browser it is a download, the editor's own way. */
const save = Capacitor.isNativePlatform() ? shareThrough(exportFiles, Share) : undefined;

const root = document.getElementById('machine');
if (!root) throw new Error('the page has no place for the machine');

askToBeHeard();
const storage = await draftStorage();

createRoot(root).render(
  <StrictMode>
    <BoombapbotEditor
      machine={machine}
      baseUrl={import.meta.env.BASE_URL}
      storage={storage}
      save={save}
      below={tools}
    />
  </StrictMode>,
);

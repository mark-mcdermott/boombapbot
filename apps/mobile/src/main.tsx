import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import {
  BoombapbotEditor,
  NativeAudioController,
  shellFooter,
  shellSiteFooter,
  type AudioFactory,
  type KeyValueStorage,
  type ShellSite,
} from '@boombapbot/editor';
import { machine } from '@boombapbot/machine-ritm12';
import { openDeviceStorage } from './device-storage';
import { PageScreen } from './PageScreen';
import { PAGES_FILE, PAGES_URL, readPages, type CarriedPages } from './pages';
import { ENGINE_PLUGIN, checkIfAsked, pluginEngine, type EnginePlugin } from './native-engine';
import { shareThrough, type DeviceFiles } from './share-file';
import './styles.css';

interface AudioSessionNavigator {
  audioSession?: { type: string };
}

/**
 * Sound made with Web Audio counts as ambient on an iPhone, which the ringer
 * switch silences. A drum machine is for playing, so it asks to be heard.
 * Where the engine runs natively, the plug-in sets the phone's sound up
 * itself, and this only matters for the web view's own.
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

/**
 * On a phone the beat plays through the engine built natively, by way of the
 * plug-in. In a browser, which has no plug-in, it plays through the page's
 * own worklet.
 */
const enginePlugin = Capacitor.isPluginAvailable(ENGINE_PLUGIN) ? registerPlugin<EnginePlugin>(ENGINE_PLUGIN) : null;
const audio: AudioFactory | undefined = enginePlugin
  ? (events) => new NativeAudioController(pluginEngine(enginePlugin), events)
  : undefined;

/** The pages are in the app; the shop is on the site, and opens in the phone's browser. */
const site: ShellSite = { pagesUrl: PAGES_URL, shopUrl: 'https://boombapbot.com/?cart=open' };

/** The pages of words the app carries. Without them the machine is all there is, as it was. */
async function carriedPages(): Promise<CarriedPages | null> {
  try {
    const answer = await fetch(`${import.meta.env.BASE_URL}${PAGES_FILE}`);
    if (!answer.ok) throw new Error(`the pages file answered ${answer.status}`);
    return readPages(await answer.json());
  } catch (error) {
    console.error('The pages of words could not be read, so the app goes without them.', error);
    return null;
  }
}

const root = document.getElementById('machine');
const machineScreen = document.getElementById('machine-screen');
const pagesRoot = document.getElementById('pages');
if (!root || !machineScreen || !pagesRoot) throw new Error('the page has no place for the machine');

askToBeHeard();
const [storage, pages] = await Promise.all([draftStorage(), carriedPages()]);

createRoot(root).render(
  <StrictMode>
    <BoombapbotEditor
      machine={machine}
      baseUrl={import.meta.env.BASE_URL}
      storage={storage}
      save={save}
      audio={audio}
      below={pages ? shellSiteFooter(site) : shellFooter}
    />
  </StrictMode>,
);

/** Android's back button leaves a page for where it was opened from, and from the machine puts the app away. */
if (Capacitor.getPlatform() === 'android') {
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.minimizeApp();
  });
}

if (pages) {
  createRoot(pagesRoot).render(
    <StrictMode>
      <PageScreen pages={pages} site={site} machineScreen={machineScreen} />
    </StrictMode>,
  );
}

if (enginePlugin) void checkIfAsked(enginePlugin).catch((error: unknown) => console.error('The check could not start.', error));

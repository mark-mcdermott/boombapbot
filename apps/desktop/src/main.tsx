import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  BoombapbotEditor,
  NativeAudioController,
  browserStorage,
  linkServer,
  shellAccountFooter,
  type AudioFactory,
} from '@boombapbot/editor';
import { machine } from '@boombapbot/machine-ritm12';
import { checkIfAsked } from './check';
import { saveThroughApp } from './save-export';
import { openTokenStore } from './session-token';
import { tauriEngine } from './tauri-engine';
import './styles.css';

const root = document.getElementById('machine');
if (!root) throw new Error('the page has no place for the machine');

/**
 * In the app the beat plays through the engine the app runs natively, and an
 * export goes where the person says. Served to a browser, which `pnpm dev`
 * does, the page plays through its own worklet and an export is a download,
 * as on the site.
 */
const inApp = isTauri();
const audio: AudioFactory | undefined = inApp
  ? (events) => new NativeAudioController(tauriEngine({ invoke, listen }), events)
  : undefined;
const save = inApp ? saveThroughApp(invoke) : undefined;

/** The site, whose server keeps the accounts. A build for a test names another. */
const SITE_URL: string = import.meta.env.VITE_SITE_URL ?? 'https://boombapbot.com/';

/**
 * The window's page is not served from the site, so the site's cookie cannot
 * follow it: the log-in is a token, kept where the web view keeps the draft.
 */
linkServer({ url: SITE_URL, token: openTokenStore(browserStorage()) });

createRoot(root).render(
  <StrictMode>
    <BoombapbotEditor
      machine={machine}
      baseUrl={import.meta.env.BASE_URL}
      audio={audio}
      save={save}
      below={shellAccountFooter(SITE_URL)}
      accounts
    />
  </StrictMode>,
);

if (inApp) void checkIfAsked(invoke).catch((error: unknown) => console.error('The check could not start.', error));

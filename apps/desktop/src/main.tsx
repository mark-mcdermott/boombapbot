import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { BoombapbotEditor, NativeAudioController, shellFooter, type AudioFactory } from '@boombapbot/editor';
import { machine } from '@boombapbot/machine-ritm12';
import { checkIfAsked } from './check';
import { saveThroughApp } from './save-export';
import { tauriEngine } from './tauri-engine';
import './styles.css';

const root = document.getElementById('machine');
if (!root) throw new Error('the page has no place for the machine');

/**
 * In the app the beat plays through the engine the app runs natively, and an
 * export goes where the person says. Served to a browser, which `pnpm dev`
 * does, the page is the editor as the site has it: its own worklet, and a
 * download.
 */
const inApp = isTauri();
const audio: AudioFactory | undefined = inApp
  ? (events) => new NativeAudioController(tauriEngine({ invoke, listen }), events)
  : undefined;
const save = inApp ? saveThroughApp(invoke) : undefined;

createRoot(root).render(
  <StrictMode>
    <BoombapbotEditor machine={machine} baseUrl={import.meta.env.BASE_URL} audio={audio} save={save} below={shellFooter} />
  </StrictMode>,
);

if (inApp) void checkIfAsked(invoke).catch((error: unknown) => console.error('The check could not start.', error));

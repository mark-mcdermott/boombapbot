import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createProjectCodec } from '@boombapbot/contracts';
import {
  EditorRuntime,
  NativeAudioController,
  RuntimeContext,
  deviceLicense,
  keepDeviceLicenseIn,
  type AudioFactory,
} from '@boombapbot/editor';
import { machine } from '@boombapbot/machine-ritm12';
import type { Project } from '@boombapbot/machine-ritm12/document';
import { Bar } from './Bar';
import { connectPlugin, type Plugin } from './juce';
import { pluginEngine } from './plugin-engine';
import './styles.css';

declare global {
  interface Window {
    /** For the check that opens the plugin's window. Not a stable API. */
    __panel?: { project(): Project; level(): number; upgraded(): boolean; atRest(): boolean };
  }
}

/** The event a beat changed in the plugin arrives on: a host's automation, a recalled project. */
const BEAT_EVENT = 'beat';

/** A burst of changes, as a knob being dragged makes, goes to the plugin this often at the most. */
const SEND_AFTER_MS = 16;

const root = document.getElementById('machine');
if (!root) throw new Error('the page has no place for the machine');

// The license file is the plugin's to read, from the machine's disk, each
// time it is loaded. The page keeps none: it is handed the file as it opens.
keepDeviceLicenseIn(null);

const plugin = connectPlugin();
const codec = createProjectCodec([machine.document]);

const audio: AudioFactory | undefined = plugin
  ? (events) => new NativeAudioController(pluginEngine(plugin), events)
  : undefined;

// The plugin keeps the beat, in the host's project. The page keeps no draft of its own.
const runtime = new EditorRuntime({ baseUrl: import.meta.env.BASE_URL, machine, storage: null, audio });

/**
 * A beat as the plugin holds it, laid over the page's: the plugin does not
 * keep which beat this is or what the step keys write, so those stay.
 */
function fromPlugin(text: string): Project | null {
  const result = codec.parseText(text);
  if (!result.ok) return null;
  const mine = runtime.store.getState().project;
  const theirs = result.project;
  return {
    ...theirs,
    id: mine.id,
    createdAt: mine.createdAt,
    updatedAt: mine.updatedAt,
    panel: { ...theirs.panel, write: mine.panel.write },
  };
}

interface InStep {
  /** Sends at once whatever is waiting to go. */
  sendWaiting(): void;
  /** Whether a change on the page has yet to be sent. */
  hasWaiting(): boolean;
}

/** Keeps the page's beat and the plugin's the same, whichever side changed it. */
function keepInStep(plugin: Plugin): InStep {
  let theirs: Project | null = null;
  let waiting: ReturnType<typeof setTimeout> | null = null;
  let taking = false;

  const send = () => {
    if (waiting === null) return;
    clearTimeout(waiting);
    waiting = null;
    const project = runtime.store.getState().project;
    if (project !== theirs) void plugin.call('setBeat', codec.serialize(project));
  };

  plugin.on<string>(BEAT_EVENT, (text) => {
    const project = fromPlugin(text);
    if (!project) return;
    // The store keeps a stamped copy of what it is given: theirs is that copy.
    taking = true;
    runtime.store.adjust(project);
    theirs = runtime.store.getState().project;
    taking = false;
  });
  runtime.store.subscribe(() => {
    // A change that came from the plugin is not sent back to it, and a burst
    // of changes, as a knob being dragged makes, goes as the last of them.
    if (taking || runtime.store.getState().project === theirs || waiting !== null) return;
    // A timer, not an animation frame: a window behind another draws no frames.
    waiting = setTimeout(send, SEND_AFTER_MS);
  });
  return { sendWaiting: send, hasWaiting: () => waiting !== null };
}

/**
 * Tells the plugin while a knob is held, so that a host recording automation
 * takes the whole turn as one gesture. The last of the turn goes first.
 */
function markKnobHolds(plugin: Plugin, sendWaiting: () => void): void {
  let held = false;
  const letGo = () => {
    if (!held) return;
    held = false;
    sendWaiting();
    void plugin.call('holdKnob', false);
  };
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[role="slider"]')) return;
      held = true;
      void plugin.call('holdKnob', true);
    },
    true,
  );
  window.addEventListener('pointerup', letGo, true);
  window.addEventListener('pointercancel', letGo, true);
}

/**
 * The controls a host has taken over, by the name each has on the panel. The
 * host keeps the tempo and does the recording, and the machine is on for as
 * long as its window is open. They stay in the picture and take no hand.
 */
const KEPT_BY_HOST = ['tempo', 'record', 'power'];

function Window() {
  useEffect(() => {
    for (const control of KEPT_BY_HOST) {
      document.querySelector<HTMLElement>(`[data-testid="${control}"]`)?.setAttribute('inert', '');
    }
  });
  // The plugin starts telling the page things when it hears this, and tells
  // each once. An effect here runs after the bar's, so the bar is listening.
  useEffect(() => {
    void plugin?.call('pageReady');
  }, []);
  return (
    <>
      <div className="pb-picture">
        <machine.Panel />
      </div>
      <Bar plugin={plugin} />
    </>
  );
}

async function open(): Promise<void> {
  let inStep: InStep | null = null;
  if (plugin) {
    // Before anything is drawn, so the selector reaches the upgrade's effects from the first.
    const license = await plugin.call<string>('licenseFile');
    if (license) deviceLicense().keep(license, 'key');
    const held = fromPlugin(await plugin.call<string>('getBeat'));
    if (held) runtime.store.replaceProject(held);
    inStep = keepInStep(plugin);
    markKnobHolds(plugin, inStep.sendWaiting);
  }
  runtime.attach();
  // In a host the machine is on when its window is open, and it plays when the host does.
  runtime.setPower(true);
  if (plugin && (await plugin.call<boolean>('sequencerOn'))) void runtime.play();

  // The context is not generic. The machine's own hooks give its panel the types back.
  const shared = runtime as unknown as EditorRuntime;
  window.__panel = {
    project: () => runtime.store.getState().project,
    level: () => runtime.outputLevel(),
    upgraded: () => deviceLicense().upgraded,
    // Nothing of the page's is on its way to the plugin: all of it was sent, and the plugin has answered.
    atRest: () => !inStep?.hasWaiting() && (plugin?.answered() ?? true),
  };
  createRoot(root!).render(
    <StrictMode>
      <RuntimeContext.Provider value={shared}>
        <Window />
      </RuntimeContext.Provider>
    </StrictMode>,
  );
}

void open();

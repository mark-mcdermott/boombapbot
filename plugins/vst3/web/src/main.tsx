import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createProjectCodec } from '@boombapbot/contracts';
import { EditorRuntime, NativeAudioController, RuntimeContext, type AudioFactory } from '@boombapbot/editor';
import { machine } from '@boombapbot/machine-ritm12';
import type { Project } from '@boombapbot/machine-ritm12/document';
import { connectPlugin, type Plugin } from './juce';
import { pluginEngine } from './plugin-engine';
import './styles.css';

declare global {
  interface Window {
    /** For the check that opens the plugin's window. Not a stable API. */
    __panel?: { project(): Project };
  }
}

/** The event a beat changed in the plugin arrives on: a host's automation, a recalled project. */
const BEAT_EVENT = 'beat';

/** A burst of changes, as a knob being dragged makes, goes to the plugin this often at the most. */
const SEND_AFTER_MS = 16;

const root = document.getElementById('machine');
if (!root) throw new Error('the page has no place for the machine');

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

/** Keeps the page's beat and the plugin's the same, whichever side changed it. */
function keepInStep(plugin: Plugin): void {
  let theirs: Project | null = null;
  let sending = false;

  const take = (text: string) => {
    const project = fromPlugin(text);
    if (!project) return;
    theirs = project;
    runtime.store.adjust(project);
  };

  plugin.on<string>(BEAT_EVENT, take);
  runtime.store.subscribe(() => {
    // A change that came from the plugin is not sent back to it, and a burst
    // of changes, as a knob being dragged makes, goes as the last of them.
    if (runtime.store.getState().project === theirs || sending) return;
    sending = true;
    // A timer, not an animation frame: a window behind another draws no frames.
    setTimeout(() => {
      sending = false;
      const project = runtime.store.getState().project;
      if (project !== theirs) void plugin.call('setBeat', codec.serialize(project));
    }, SEND_AFTER_MS);
  });
}

async function open(): Promise<void> {
  if (plugin) {
    const held = fromPlugin(await plugin.call<string>('getBeat'));
    if (held) runtime.store.replaceProject(held);
    keepInStep(plugin);
  }
  runtime.attach();
  // In a host the machine is on when its window is open, and it plays when the host does.
  runtime.setPower(true);
  if (plugin && (await plugin.call<boolean>('sequencerOn'))) void runtime.play();

  // The context is not generic. The machine's own hooks give its panel the types back.
  const shared = runtime as unknown as EditorRuntime;
  createRoot(root!).render(
    <StrictMode>
      <RuntimeContext.Provider value={shared}>
        <machine.Panel />
      </RuntimeContext.Provider>
    </StrictMode>,
  );
  window.__panel = { project: () => runtime.store.getState().project };
  void plugin?.call('pageReady');
}

void open();

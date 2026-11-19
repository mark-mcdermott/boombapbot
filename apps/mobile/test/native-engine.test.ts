import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EngineReport, NativeEngineCommand } from '@boombapbot/editor';
import { ENGINE_PLUGIN, REPORT_EVENT, pluginEngine, type EnginePlugin } from '../src/native-engine';

/** The plug-in with no phone behind it: it notes what the page asks, and answers what the test says. */
function fakePlugin() {
  const called: Array<{ method: string; options?: unknown }> = [];
  const listeners = new Map<string, (report: EngineReport) => void>();
  const plugin: EnginePlugin = {
    open: async () => {
      called.push({ method: 'open' });
      return { sampleRate: 48000 };
    },
    send: async (options) => {
      called.push({ method: 'send', options });
    },
    close: async () => {
      called.push({ method: 'close' });
    },
    addListener: async (event, listener) => {
      listeners.set(event, listener);
      return { remove: async () => void listeners.delete(event) };
    },
    checkMode: async () => ({ mode: null }),
    checkEngine: async () => ({}),
    checkLose: async () => undefined,
    checkReport: async () => undefined,
  };
  return { plugin, called, listeners };
}

const swift = readFileSync(new URL('../native-engine/ios/Sources/EnginePlugin/EnginePlugin.swift', import.meta.url), 'utf8');
/** The methods the plug-in answers: what its `pluginMethods` lists. */
const pluginMethods = [...swift.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map((match) => match[1]);

describe('the bridge to the phone\'s engine', () => {
  it('opens the engine and answers with its rate', async () => {
    const { plugin, called } = fakePlugin();
    await expect(pluginEngine(plugin).open()).resolves.toEqual({ sampleRate: 48000 });
    expect(called).toEqual([{ method: 'open' }]);
  });

  it('sends commands together, as they are', async () => {
    const { plugin, called } = fakePlugin();
    const commands: NativeEngineCommand[] = [
      { type: 'tempo', bpm: 97 },
      { type: 'effect', effect: 2, wet: 0.5 },
      { type: 'synth', sound: { sound: 1, tune: 0.5, tone: 0.5, decay: 0.5, snappy: 0.5 } },
      { type: 'play' },
    ];
    await pluginEngine(plugin).send(commands);
    expect(called).toEqual([{ method: 'send', options: { commands } }]);
  });

  it('passes on the engine\'s reports until told to stop', async () => {
    const { plugin, listeners } = fakePlugin();
    const heard: EngineReport[] = [];
    const stop = await pluginEngine(plugin).listen((report) => heard.push(report));
    listeners.get(REPORT_EVENT)?.({ type: 'position', step: 4, pattern: 0, playing: true });
    stop();
    await Promise.resolve();
    listeners.get(REPORT_EVENT)?.({ type: 'ended' });
    expect(heard).toEqual([{ type: 'position', step: 4, pattern: 0, playing: true }]);
    expect(listeners.size).toBe(0);
  });

  it('closes the engine', async () => {
    const { plugin, called } = fakePlugin();
    await pluginEngine(plugin).close();
    expect(called).toEqual([{ method: 'close' }]);
  });

  it('asks only for what the plug-in has, by the name it registers and the event it reports on', () => {
    const asked: Array<keyof EnginePlugin> = ['open', 'send', 'close', 'checkMode', 'checkEngine', 'checkLose', 'checkReport'];
    expect(pluginMethods).toEqual(expect.arrayContaining(asked));
    expect(swift).toContain(`jsName = "${ENGINE_PLUGIN}"`);
    expect(swift).toContain(`reportEvent = "${REPORT_EVENT}"`);
  });
});

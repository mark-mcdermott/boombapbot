import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EngineReport, NativeEngineCommand } from '@boombapbot/editor';
import { saveThroughApp } from '../src/save-export';
import { REPORT_EVENT, tauriEngine, type TauriCalls } from '../src/tauri-engine';

/** Tauri with no app behind it: it notes what the page asks, and answers what the test says. */
function fakeTauri(answers: Record<string, unknown> = {}) {
  const invoked: Array<{ command: string; args: unknown }> = [];
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const calls: TauriCalls = {
    invoke: async <Answer>(command: string, args?: unknown) => {
      invoked.push({ command, args });
      return answers[command] as Answer;
    },
    listen: async <Payload>(event: string, handler: (event: { payload: Payload }) => void) => {
      handlers.set(event, handler as (event: { payload: unknown }) => void);
      return () => handlers.delete(event);
    },
  };
  const emit = (event: string, payload: unknown) => handlers.get(event)?.({ payload });
  return { calls, invoked, handlers, emit };
}

const appSource = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
/** The commands the app answers: what `generate_handler!` lists, by their last name. */
const appCommands = /generate_handler!\[([^\]]*)\]/
  .exec(appSource)![1]!.split(',')
  .map((name) => name.trim().split('::').pop()!)
  .filter(Boolean);

describe('the bridge to the app\'s engine', () => {
  it('opens the engine and answers with its rate', async () => {
    const { calls, invoked } = fakeTauri({ engine_open: { sampleRate: 44100 } });
    await expect(tauriEngine(calls).open()).resolves.toEqual({ sampleRate: 44100 });
    expect(invoked).toEqual([{ command: 'engine_open', args: undefined }]);
  });

  it('sends commands together, as they are', async () => {
    const { calls, invoked } = fakeTauri();
    const commands: NativeEngineCommand[] = [
      { type: 'tempo', bpm: 97 },
      { type: 'effect', effect: 2, wet: 0.5 },
      { type: 'synth', sound: { sound: 1, tune: 0.5, tone: 0.5, decay: 0.5, snappy: 0.5 } },
      { type: 'play' },
    ];
    await tauriEngine(calls).send(commands);
    expect(invoked).toEqual([{ command: 'engine_send', args: { commands } }]);
  });

  it('passes on the engine\'s reports until told to stop', async () => {
    const { calls, emit, handlers } = fakeTauri();
    const heard: EngineReport[] = [];
    const stop = await tauriEngine(calls).listen((report) => heard.push(report));
    emit(REPORT_EVENT, { type: 'position', step: 4, pattern: 0, playing: true });
    stop();
    emit(REPORT_EVENT, { type: 'ended' });
    expect(heard).toEqual([{ type: 'position', step: 4, pattern: 0, playing: true }]);
    expect(handlers.size).toBe(0);
  });

  it('closes the engine', async () => {
    const { calls, invoked } = fakeTauri();
    await tauriEngine(calls).close();
    expect(invoked).toEqual([{ command: 'engine_close', args: undefined }]);
  });

  it('asks only for commands the app has, and listens on the event it reports on', async () => {
    const { calls, invoked } = fakeTauri({ engine_open: { sampleRate: 48000 }, export_ask: true });
    const bridge = tauriEngine(calls);
    await bridge.open();
    await bridge.send([]);
    await bridge.close();
    await saveThroughApp(calls.invoke)({ name: 'beat.wav', data: new Uint8Array(1), type: 'audio/wav' });

    expect(appCommands).toEqual(expect.arrayContaining(invoked.map((call) => call.command)));
    expect(appSource).toContain(`const REPORT_EVENT: &str = "${REPORT_EVENT}";`);
  });
});

describe('where an export goes in the app', () => {
  it('is written where the person chose, as bytes', async () => {
    const { calls, invoked } = fakeTauri({ export_ask: true });
    const bytes = new Uint8Array([82, 73, 70, 70]);
    await expect(saveThroughApp(calls.invoke)({ name: 'beat.wav', data: bytes, type: 'audio/wav' })).resolves.toBe(true);
    expect(invoked).toEqual([
      { command: 'export_ask', args: { name: 'beat.wav' } },
      { command: 'export_write', args: bytes },
    ]);
  });

  it('writes a project file\'s text as bytes too', async () => {
    const { calls, invoked } = fakeTauri({ export_ask: true });
    await saveThroughApp(calls.invoke)({ name: 'beat.boombapbot.json', data: '{"name":"Ритм"}', type: 'application/json' });
    expect(new TextDecoder().decode(invoked[1]!.args as Uint8Array)).toBe('{"name":"Ритм"}');
  });

  it('writes nothing, and says so, when the person turned it down', async () => {
    const { calls, invoked } = fakeTauri({ export_ask: false });
    await expect(saveThroughApp(calls.invoke)({ name: 'beat.mid', data: new Uint8Array(4), type: 'audio/midi' })).resolves.toBe(false);
    expect(invoked.map((call) => call.command)).toEqual(['export_ask']);
  });
});

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EFFECT, type SynthSound } from '../src/engine';
import {
  EngineCommands,
  type AudioControllerEvents,
  type SampledEngineAudio,
  type SynthEngineAudio,
} from '../src/engine/engine-audio';
import type { EngineCommand, EngineReport, NativeEngineCommand, SharedEngineCommand } from '../src/engine/messages';
import { NativeAudioController, type NativeEngineBridge } from '../src/engine/native-audio';
import { EditorRuntime } from '../src/runtime';
import { loadWasm, rms, wasmPath } from './helpers';
import { testMachine, testSetup } from './test-machine';

// A shell hands the runtime its own controller. These stand in for one: the
// first takes its sounds as samples, as the page's worklet does, and the
// second makes them itself from the knobs, as a native engine does.

const RATE = 48000;

/** What every stand-in shares: it notes what it is told, and says what an engine would. */
abstract class StandIn extends EngineCommands {
  readonly told: Array<SharedEngineCommand | { type: 'effect'; kind: string; wet: number }> = [];
  status: 'idle' | 'running' = 'idle';
  sampleRate: number | null = null;
  starts = 0;

  constructor(readonly events: AudioControllerEvents) {
    super();
  }

  get isReady(): boolean {
    return this.sampleRate !== null;
  }

  async start(): Promise<void> {
    this.starts += 1;
    this.sampleRate = RATE;
    this.status = 'running';
    this.events.onState('running', null);
  }

  protected post(command: SharedEngineCommand): void {
    this.told.push(command);
  }

  setEffect(effect: { kind: string; wet: number }): void {
    this.told.push({ type: 'effect', ...effect });
  }

  async dispose(): Promise<void> {
    this.sampleRate = null;
    this.status = 'idle';
  }

  /** The kinds of command it was told since the last time this was asked. */
  heard(): string[] {
    return this.told.splice(0).map((command) => command.type);
  }
}

class SampledStandIn extends StandIn implements SampledEngineAudio {
  readonly sounds: Array<{ slot: number; pcm: Float32Array; channels: number; sampleRate: number }> = [];
  setSound(slot: number, pcm: Float32Array, channels: number, sampleRate: number): void {
    this.sounds.push({ slot, pcm, channels, sampleRate });
  }
}

class SynthStandIn extends StandIn implements SynthEngineAudio {
  readonly sounds: SynthSound[] = [];
  synthSound(sound: SynthSound): void {
    this.sounds.push(sound);
  }
}

function withAudio<Audio extends SampledStandIn | SynthStandIn>(make: (events: AudioControllerEvents) => Audio) {
  let audio: Audio | undefined;
  const runtime = new EditorRuntime({
    baseUrl: '/',
    storage: null,
    machine: testMachine,
    audio: (events) => (audio = make(events)),
  });
  runtime.attach();
  if (!audio) throw new Error('the runtime did not ask for a controller');
  return { runtime, audio, store: runtime.store };
}

const synthMachine = () => withAudio((events) => new SynthStandIn(events));

/** Lets the runtime's promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Serves the asset manifest and the engine, as a site would. */
function serveEngine(): string[] {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url);
    if (url === '/boombapbot-assets.json') {
      return Response.json({ machine: 'test', engine: { worklet: 'engine/worklet.js', wasm: 'engine/engine.wasm' }, faceplate: null });
    }
    if (url === '/engine/engine.wasm') return new Response(readFileSync(wasmPath('ritm12')));
    return new Response(null, { status: 404 });
  });
  return asked;
}

/** A page with nothing to fetch: any request fails, and is counted. */
function serveNothing(): string[] {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url);
    throw new Error('this shell has no server');
  });
  return asked;
}

afterEach(() => vi.unstubAllGlobals());

describe('a controller handed to the runtime', () => {
  it('is the one the runtime plays through, and is told the whole setup before play', async () => {
    serveNothing();
    const { runtime, audio, store } = synthMachine();
    await runtime.play();

    expect(audio.starts).toBe(1);
    expect(audio.heard()).toEqual(['tempo', 'tracks', 'mix', 'patterns', 'cue', 'effect', 'song', 'play']);
    expect(audio.sounds).toEqual(testSetup(store.getState().project).sounds);
    expect(store.getState()).toMatchObject({ playing: true, audioStatus: 'running' });
    expect(runtime.debug()).toMatchObject({ sampleRate: RATE, soundsSent: 2 });
  });

  it('is told only what changed afterwards', async () => {
    serveNothing();
    const { runtime, audio, store } = synthMachine();
    await runtime.play();
    audio.heard();
    audio.sounds.length = 0;

    store.adjust({ ...store.getState().project, tempo: 97 });
    expect(audio.told).toEqual([{ type: 'tempo', bpm: 97 }]);
    expect(audio.sounds).toEqual([]);

    runtime.stop();
    expect(audio.heard()).toEqual(['tempo', 'stop']);
    expect(store.getState().playing).toBe(false);
  });

  it('that makes its own sounds is sent the knobs, and the page fetches nothing to play', async () => {
    const asked = serveNothing();
    const { runtime, audio, store } = synthMachine();
    asked.length = 0;
    await runtime.play();
    store.adjust({ ...store.getState().project, tune: 0.9 });
    await settle();

    expect(asked).toEqual([]);
    // The first setting of slot 0 has not been acknowledged, so the new one waits for it.
    expect(audio.sounds.map((sound) => [sound.sound, sound.tune])).toEqual([[0, 0.5], [1, 0.5]]);
    audio.events.onSound(0);
    expect(audio.sounds.at(-1)).toMatchObject({ sound: 0, tune: 0.9 });
    await settle();
    expect(runtime.debug()).toMatchObject({ soundsSent: 3, soundsTaken: 1 });
  });

  it('that takes samples is sent each sound synthesised at its own rate', async () => {
    serveEngine();
    const { runtime, audio, store } = withAudio((events) => new SampledStandIn(events));
    await runtime.play();
    await vi.waitFor(() => expect(audio.sounds).toHaveLength(2));

    const expected = loadWasm('ritm12').synthesise(testSetup(store.getState().project).sounds[0]!, RATE);
    expect(audio.sounds.map((sound) => sound.slot)).toEqual([0, 1]);
    expect(audio.sounds[0]).toMatchObject({ channels: 1, sampleRate: RATE });
    expect(audio.sounds[0]!.pcm).toEqual(expected);
    expect(rms(audio.sounds[0]!.pcm)).toBeGreaterThan(0.01);
  });

  it('reports to the store and the runtime as the worklet does', async () => {
    serveNothing();
    const { runtime, audio, store } = synthMachine();
    await runtime.play();

    audio.events.onPosition(3, 0, true);
    expect(store.getState()).toMatchObject({ currentStep: 3, currentPattern: 0 });
    audio.events.onLevel(0.4);
    expect(runtime.outputLevel()).toBe(0.4);
    const stats = { frames: 4800, peak: 0.5, peakEver: 0.6, voices: 2, stolen: 0 };
    audio.events.onStats(stats);
    expect(runtime.debug().stats).toEqual(stats);

    audio.events.onEnded();
    expect(store.getState()).toMatchObject({ playing: false, currentStep: -1 });
    // A late report from the engine that has stopped moves nothing.
    audio.events.onPosition(5, 0, true);
    expect(store.getState().currentStep).toBe(-1);
  });

  it('is told everything again, and to play on, when its engine was made again', async () => {
    serveNothing();
    const { runtime, audio, store } = synthMachine();
    await runtime.play();
    store.adjust({ ...store.getState().project, tempo: 97 });
    audio.heard();
    audio.sounds.length = 0;

    audio.sampleRate = 44100;
    audio.events.onReset();

    expect(audio.told[0]).toEqual({ type: 'tempo', bpm: 97 });
    expect(audio.heard()).toEqual(['tempo', 'tracks', 'mix', 'patterns', 'cue', 'effect', 'song', 'play']);
    // Both sounds again, though neither was acknowledged by the engine that is gone.
    expect(audio.sounds.map((sound) => sound.sound)).toEqual([0, 1]);
    expect(runtime.debug().sampleRate).toBe(44100);
    expect(store.getState().playing).toBe(true);
  });

  it('is not told to play by a new engine when the machine was stopped', async () => {
    serveNothing();
    const { runtime, audio } = synthMachine();
    await runtime.play();
    runtime.stop();
    audio.heard();

    audio.events.onReset();
    expect(audio.heard()).toEqual(['tempo', 'tracks', 'mix', 'patterns', 'cue', 'effect']);

    await runtime.play();
    audio.events.onEnded();
    audio.heard();
    audio.events.onReset();
    expect(audio.heard()).not.toContain('play');
  });

  it('is closed when the editor goes', async () => {
    serveNothing();
    const { runtime, audio } = synthMachine();
    await runtime.play();
    runtime.detach();
    expect(audio.isReady).toBe(false);
  });
});

/** A bridge to no engine: it notes each call, and answers when the test says so. */
class FakeBridge implements NativeEngineBridge {
  readonly sent: NativeEngineCommand[][] = [];
  opens = 0;
  closes = 0;
  listening = false;
  sampleRate = RATE;
  failOpen: string | null = null;
  failSend: string | null = null;
  /** Held, a send does not answer until `release` is called. */
  hold = false;
  private held: Array<() => void> = [];
  private report: ((report: EngineReport) => void) | null = null;

  async open(): Promise<{ sampleRate: number }> {
    this.opens += 1;
    if (this.failOpen) throw new Error(this.failOpen);
    return { sampleRate: this.sampleRate };
  }

  async send(commands: NativeEngineCommand[]): Promise<void> {
    this.sent.push(commands);
    if (this.failSend) throw new Error(this.failSend);
    if (this.hold) await new Promise<void>((resolve) => this.held.push(resolve));
  }

  async listen(onReport: (report: EngineReport) => void): Promise<() => void> {
    this.report = onReport;
    this.listening = true;
    return () => {
      this.report = null;
      this.listening = false;
    };
  }

  async close(): Promise<void> {
    this.closes += 1;
  }

  release(): void {
    this.held.splice(0).forEach((resolve) => resolve());
  }

  says(report: EngineReport): void {
    this.report?.(report);
  }

  types(): string[][] {
    return this.sent.map((commands) => commands.map((command) => command.type));
  }
}

function recordingEvents() {
  const calls: Array<[string, ...unknown[]]> = [];
  const note = (name: string) => (...args: unknown[]) => {
    calls.push([name, ...args]);
  };
  const events: AudioControllerEvents = {
    onState: note('state'),
    onPosition: note('position'),
    onStats: note('stats'),
    onMeasures: note('measures'),
    onEnded: note('ended'),
    onSound: note('sound'),
    onLevel: note('level'),
    onReset: note('reset'),
  };
  return { events, calls };
}

function nativeController() {
  const bridge = new FakeBridge();
  const { events, calls } = recordingEvents();
  return { bridge, calls, audio: new NativeAudioController(bridge, events) };
}

describe('the controller of a native engine', () => {
  it('opens the engine once and runs at the rate it answers with', async () => {
    const { bridge, calls, audio } = nativeController();
    expect(audio.isReady).toBe(false);
    await Promise.all([audio.start(), audio.start()]);
    await audio.start();

    expect(bridge.opens).toBe(1);
    expect(bridge.listening).toBe(true);
    expect(audio).toMatchObject({ isReady: true, status: 'running', sampleRate: RATE });
    expect(calls).toEqual([['state', 'starting', null], ['state', 'running', null]]);
  });

  it('says why when the engine could not be opened, and tries again when asked', async () => {
    const { bridge, calls, audio } = nativeController();
    bridge.failOpen = 'no sound device';
    await expect(audio.start()).rejects.toThrow('no sound device');
    expect(audio).toMatchObject({ isReady: false, status: 'error' });
    expect(calls.at(-1)).toEqual(['state', 'error', 'no sound device']);

    bridge.failOpen = null;
    await audio.start();
    expect(audio).toMatchObject({ isReady: true, status: 'running' });
    expect(bridge.opens).toBe(2);
  });

  it('sends nothing before the engine is open', () => {
    const { bridge, audio } = nativeController();
    audio.play();
    audio.setTempo(120);
    expect(bridge.sent).toEqual([]);
  });

  it('sends the first command at once and the rest together, in the order given', async () => {
    const { bridge, audio } = nativeController();
    await audio.start();
    bridge.hold = true;

    audio.setTempo(133);
    audio.setMix(0.6, 1, 0.8);
    audio.cue(2);
    audio.play();
    expect(bridge.types()).toEqual([['tempo']]);

    bridge.hold = false;
    bridge.release();
    await settle();
    expect(bridge.types()).toEqual([['tempo'], ['mix', 'cue', 'play']]);

    audio.trigger(3, true);
    expect(bridge.sent.at(-1)).toEqual([{ type: 'trigger', track: 3, accent: true }]);
  });

  it('names an effect by the engine\'s number and a sound by its knobs', async () => {
    const { bridge, audio } = nativeController();
    await audio.start();
    const sound: SynthSound = { sound: 4, tune: 0.2, tone: 0.4, decay: 0.6, snappy: 0.8 };
    audio.setEffect({ kind: 'reverb', wet: 0.5 });
    audio.synthSound(sound);
    await settle();

    expect(bridge.sent.flat()).toEqual([
      { type: 'effect', effect: EFFECT.reverb, wet: 0.5 },
      { type: 'synth', sound },
    ]);
  });

  it('passes on what the engine reports', async () => {
    const { bridge, calls, audio } = nativeController();
    await audio.start();
    calls.length = 0;
    const stats = { frames: 4800, peak: 0.5, peakEver: 0.6, voices: 2, stolen: 0 };
    const measure = { frame: 0, ordinal: 1, pattern: 0, kind: 'basic' as const, position: -1 };

    bridge.says({ type: 'position', step: 2, pattern: 1, playing: true });
    bridge.says({ type: 'stats', ...stats });
    bridge.says({ type: 'measures', measures: [measure] });
    bridge.says({ type: 'sound', slot: 5 });
    bridge.says({ type: 'level', level: 0.3 });
    bridge.says({ type: 'ended' });

    expect(calls).toEqual([
      ['position', 2, 1, true],
      ['stats', { type: 'stats', ...stats }],
      ['measures', [measure]],
      ['sound', 5],
      ['level', 0.3],
      ['ended'],
    ]);
  });

  it('takes the new rate and asks to be told everything when the engine was made again', async () => {
    const { bridge, calls, audio } = nativeController();
    await audio.start();
    calls.length = 0;

    bridge.says({ type: 'ready', sampleRate: 44100 });
    expect(audio).toMatchObject({ isReady: true, status: 'running', sampleRate: 44100 });
    expect(calls).toEqual([['state', 'running', null], ['reset']]);
  });

  it('stops sending when the engine fails, and opens it again on the next start', async () => {
    const { bridge, calls, audio } = nativeController();
    await audio.start();

    bridge.says({ type: 'error', message: 'the sound device went away' });
    expect(audio).toMatchObject({ isReady: false, status: 'error' });
    expect(calls.at(-1)).toEqual(['state', 'error', 'the sound device went away']);
    audio.play();
    expect(bridge.sent).toEqual([]);

    await audio.start();
    expect(bridge.opens).toBe(2);
    expect(audio.status).toBe('running');
  });

  it('fails when the bridge refuses a command', async () => {
    const { bridge, calls, audio } = nativeController();
    await audio.start();
    bridge.failSend = 'the engine refused a pattern';
    audio.setTempo(120);
    await settle();

    expect(audio).toMatchObject({ isReady: false, status: 'error' });
    expect(calls.at(-1)).toEqual(['state', 'error', 'the engine refused a pattern']);
  });

  it('closes the engine and stops listening when disposed', async () => {
    const { bridge, audio } = nativeController();
    await audio.start();
    await audio.dispose();

    expect(bridge.closes).toBe(1);
    expect(bridge.listening).toBe(false);
    expect(audio).toMatchObject({ isReady: false, status: 'idle', sampleRate: null });
  });
});

describe('a runtime playing through a native engine', () => {
  it('sends the beat as commands a native bridge takes, and tells a new engine again', async () => {
    serveNothing();
    const bridge = new FakeBridge();
    const runtime = new EditorRuntime({
      baseUrl: '/',
      storage: null,
      machine: testMachine,
      audio: (events) => new NativeAudioController(bridge, events),
    });
    runtime.attach();
    await runtime.play();
    await settle();

    const first = bridge.sent.flat();
    const whole = ['tempo', 'tracks', 'mix', 'patterns', 'cue', 'effect', 'synth', 'synth', 'song', 'play'];
    expect(first.map((command) => command.type)).toEqual(whole);
    expect(first).toContainEqual({ type: 'effect', effect: EFFECT.delay, wet: 0.25 });
    // Nothing a native engine cannot take: no samples cross the bridge.
    expect(first.some((command) => (command as EngineCommand).type === 'sound')).toBe(false);

    bridge.sent.length = 0;
    bridge.says({ type: 'ready', sampleRate: 44100 });
    await settle();
    expect(bridge.sent.flat().map((command) => command.type)).toEqual(whole);
    expect(runtime.debug()).toMatchObject({ audioStatus: 'running', sampleRate: 44100 });
  });
});

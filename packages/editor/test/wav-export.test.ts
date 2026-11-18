import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { encodeWav, renderSong, type EnginePattern, type EngineSetup, type RenderPlan, type WavBitDepth } from '../src/engine';
import { runWavJob, type WavJob, type WavJobReport } from '../src/engine/wav-job';
import { renderWav, type WavWorker } from '../src/engine/wav-render';
import '../src/engine/wav-worker';
import { loadWasm, wasmPath } from './helpers';

// A WAV export renders in a Worker. What has to hold: the file is byte for
// byte the one a render on the main thread gives, the job survives the trip
// to the Worker, and a render that fails says so and leaves no Worker behind.
// The engine is РИТМ-12's only because an engine is always built for some
// machine; the setup is written out by hand.

const wasm = loadWasm('ritm12');
const RATE = 44100;

const pattern = (rows: number[], swing = 0): EnginePattern => ({
  rows: [...rows, ...new Array<number>(12 - rows.length).fill(0)],
  firstLength: 16,
  secondLength: 0,
  stepsPerBeat: 4,
  swing,
});

const setup: EngineSetup = {
  tempo: 132,
  sounds: [0, 1, 3].map((sound) => ({ sound, tune: 0.4, tone: 0.6, decay: 0.5, snappy: 0.5 })),
  tracks: [
    { track: 1, slot: 0, pan: 0, chokeGroup: 0, gain: 0.8 },
    { track: 2, slot: 1, pan: -0.2, chokeGroup: 0, gain: 0.6 },
    { track: 3, slot: 3, pan: 0.2, chokeGroup: 0, gain: 0.4 },
  ],
  accent: { plain: 0.6, accented: 1 },
  master: 0.8,
  patterns: [pattern([0x0001, 0x1111, 0x1010, 0x5555], 48), pattern([0, 0x0101, 0x1000, 0xffff])],
  effect: { kind: 'delay', wet: 0.4 },
  follow: { cue: 0 },
};

const panel = { rhythm: 0, variation: 'ab', fillRhythm: 12, fillVariation: 'a', autoFill: 0, firstBeatRule: false } as const;
const PLANS: Array<[string, RenderPlan]> = [
  ['a loop with an effect ringing round it', { pattern: 0, loop: true }],
  ['a pattern played once and left to ring out', { pattern: 1, loop: false }],
  ['a song of two measures', { panel, rhythms: [0, 0], loop: false }],
];

function job(plan: RenderPlan, bitDepth: WavBitDepth = 24): WavJob {
  return { wasm: new Uint8Array(readFileSync(wasmPath('ritm12'))).buffer, setup, plan, sampleRate: RATE, bitDepth };
}

function onMainThread(plan: RenderPlan, bitDepth: WavBitDepth): Uint8Array {
  const render = renderSong(wasm, setup, plan, RATE);
  return encodeWav(render.left, render.right, RATE, bitDepth);
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

/** The Worker's own scope, as `wav-worker.ts` uses it. Here it is the test's. */
const scope = globalThis as unknown as {
  onmessage(event: { data: WavJob }): void;
  postMessage(report: WavJobReport): void;
};

/**
 * Stands in for the Worker: the job crosses by structured clone, as it
 * would, and the Worker's real message handler answers on a later turn.
 */
class InlineWorker implements WavWorker {
  onmessage: WavWorker['onmessage'] = null;
  onerror: WavWorker['onerror'] = null;
  terminated = false;

  postMessage(sent: WavJob, transfer: Transferable[]): void {
    const received = structuredClone(sent, { transfer });
    queueMicrotask(() => {
      scope.postMessage = (data) => this.onmessage?.({ data } as MessageEvent<WavJobReport>);
      scope.onmessage({ data: received });
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('a WAV job', () => {
  for (const [name, plan] of PLANS) {
    for (const bitDepth of [24, 16] as const) {
      it(`gives the file a render on the main thread gives: ${name}, ${bitDepth}-bit`, () => {
        expect(sameBytes(runWavJob(job(plan, bitDepth), () => undefined), onMainThread(plan, bitDepth))).toBe(true);
      });
    }
  }

  it('counts the render up to its end and never back', () => {
    const heard: number[] = [];
    runWavJob(job({ pattern: 0, loop: true }), (fraction) => heard.push(fraction));
    expect(heard.length).toBeGreaterThan(10);
    expect(heard.length).toBeLessThanOrEqual(100);
    expect(heard.every((fraction, index) => fraction > (heard[index - 1] ?? 0))).toBe(true);
    expect(heard.at(-1)).toBe(1);
  });
});

describe('a WAV rendered in a Worker', () => {
  it('comes back as the same file, with its progress, and the Worker is ended', async () => {
    const worker = new InlineWorker();
    const heard: number[] = [];
    const sent = job({ pattern: 0, loop: true });
    const bytes = await renderWav(sent, (fraction) => heard.push(fraction), () => worker);
    expect(sameBytes(bytes, onMainThread({ pattern: 0, loop: true }, 24))).toBe(true);
    expect(heard.at(-1)).toBe(1);
    expect(worker.terminated).toBe(true);
    // The engine's bytes went with the job, which is why a caller sends a copy.
    expect(sent.wasm.byteLength).toBe(0);
  });

  it('fails with what the Worker said went wrong', async () => {
    const worker = new InlineWorker();
    const broken = { ...job({ pattern: 0, loop: true }), wasm: new ArrayBuffer(8) };
    await expect(renderWav(broken, () => undefined, () => worker)).rejects.toThrow(/WebAssembly/);
    expect(worker.terminated).toBe(true);
  });

  it('fails when the Worker never starts', async () => {
    const worker = new InlineWorker();
    worker.postMessage = () => queueMicrotask(() => worker.onerror?.({ message: '' } as ErrorEvent));
    await expect(renderWav(job({ pattern: 0, loop: true }), () => undefined, () => worker)).rejects.toThrow(
      'the export worker could not start',
    );
    expect(worker.terminated).toBe(true);
  });
});

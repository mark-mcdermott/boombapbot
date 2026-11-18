import { renderSong } from './offline';
import type { EngineSetup, RenderPlan } from './setup';
import { SnareWasm } from './wasm-engine';
import { encodeWav, type WavBitDepth } from './wav';

/** Everything a WAV export needs, as plain data that can cross to a Worker. */
export interface WavJob {
  /** The engine module's bytes. */
  wasm: ArrayBuffer;
  setup: EngineSetup;
  plan: RenderPlan;
  sampleRate: number;
  bitDepth: WavBitDepth;
}

/** What a Worker says while it works on a job, and how the job ended. */
export type WavJobReport =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; bytes: Uint8Array<ArrayBuffer> }
  | { type: 'failed'; message: string };

/** Renders a job and encodes it. Nothing here touches the DOM: it runs in a Worker, and in Node for tests. */
export function runWavJob(job: WavJob, onProgress: (fraction: number) => void): Uint8Array<ArrayBuffer> {
  const render = renderSong(SnareWasm.fromBytes(job.wasm), job.setup, job.plan, job.sampleRate, onProgress);
  return encodeWav(render.left, render.right, job.sampleRate, job.bitDepth);
}

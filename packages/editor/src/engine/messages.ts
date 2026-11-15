import type { EngineVoice } from './wasm-engine';

/** Main thread to worklet. */
export type EngineCommand =
  | { type: 'kit'; id: string; voices: EngineVoice[] }
  /** One slot's samples, mono or interleaved stereo. Acknowledged by slot. */
  | { type: 'sound'; slot: number; pcm: Float32Array; channels: number; sampleRate: number }
  | { type: 'pattern'; rows: number[][] }
  | { type: 'tempo'; bpm: number }
  | { type: 'swing'; swing: number }
  | { type: 'play' }
  | { type: 'stop' }
  | { type: 'trigger'; role: number; velocity: number }
  | { type: 'collect' };

/** Worklet to main thread. */
export type EngineReport =
  | { type: 'ready'; sampleRate: number }
  | { type: 'error'; message: string }
  | { type: 'kit'; id: string }
  | { type: 'sound'; slot: number }
  | { type: 'position'; step: number; playing: boolean }
  | {
      type: 'stats';
      /** Frames rendered since the processor started. */
      frames: number;
      /** Largest absolute output sample since the previous report. */
      peak: number;
      /** Largest absolute output sample since the processor started. */
      peakEver: number;
      voices: number;
      stolen: number;
    };

export const PROCESSOR_NAME = 'boombapbot-engine';

export interface ProcessorOptions {
  wasmBytes: ArrayBuffer;
}

import type { EngineEffect, EngineMeasure, EnginePanel, EnginePattern, EngineTrack } from './wasm-engine';

/** Main thread to worklet. */
export type EngineCommand =
  /** One slot's samples, mono or interleaved stereo. Acknowledged by slot. */
  | { type: 'sound'; slot: number; pcm: Float32Array; channels: number; sampleRate: number }
  | { type: 'tracks'; tracks: EngineTrack[] }
  | { type: 'mix'; plain: number; accented: number; master: number }
  | { type: 'patterns'; patterns: Array<{ index: number; pattern: EnginePattern }> }
  | { type: 'tempo'; bpm: number }
  | { type: 'panel'; panel: EnginePanel }
  /** One pattern of the bank, round and round, from the next bar line. */
  | { type: 'cue'; pattern: number }
  | { type: 'effect'; effect: EngineEffect }
  | { type: 'fill'; armed: boolean }
  /** The rhythm of each measure of a song. Empty removes it. */
  | { type: 'song'; rhythms: number[]; loop: boolean }
  | { type: 'play' }
  | { type: 'stop' }
  | { type: 'trigger'; track: number; accent: boolean };

/** Worklet to main thread. */
export type EngineReport =
  | { type: 'ready'; sampleRate: number }
  | { type: 'error'; message: string }
  | { type: 'sound'; slot: number }
  | { type: 'position'; step: number; pattern: number; playing: boolean }
  /** Measures begun since the last report, oldest first. None is ever skipped. */
  | { type: 'measures'; measures: EngineMeasure[] }
  /** Play ended by itself: a song that does not repeat reached its end. */
  | { type: 'ended' }
  /** How loud the output is now, for a meter. Sent only while it changes. */
  | { type: 'level'; level: number }
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

import type { EngineEffect, EngineMeasure, EnginePanel, EnginePattern, EngineTrack, SynthSound } from './wasm-engine';

/** The page to the worklet. */
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

/** The commands every engine takes the same way, whatever carries them. */
export type SharedEngineCommand = Exclude<EngineCommand, { type: 'sound' | 'effect' }>;

/**
 * The page to an engine a shell runs natively. Two commands differ from the
 * worklet's. Such an engine makes its own sounds, at its device's rate, so it
 * is sent a sound's knobs in place of samples and acknowledges by slot all
 * the same. And it is sent the effect by the engine's own number, so a
 * bridge needs no list of the effects there are.
 */
export type NativeEngineCommand =
  | SharedEngineCommand
  | { type: 'synth'; sound: SynthSound }
  | { type: 'effect'; effect: number; wet: number };

/**
 * An engine to the page. From a native engine, `ready` is not sent when it
 * is first opened: it says the bridge made the engine again by itself, at
 * this rate, and that the new one has been told nothing.
 */
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

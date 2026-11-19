import type { EngineReport, SharedEngineCommand } from './messages';
import type { EngineEffect, EngineMeasure, EnginePanel, EnginePattern, EngineTrack, SynthSound } from './wasm-engine';

export type AudioState = 'idle' | 'starting' | 'running' | 'suspended' | 'error';

export interface AudioStats {
  frames: number;
  peak: number;
  peakEver: number;
  voices: number;
  stolen: number;
}

export interface AudioControllerEvents {
  onState(state: AudioState, error: string | null): void;
  onPosition(step: number, pattern: number, playing: boolean): void;
  onStats(stats: AudioStats): void;
  /** Measures the engine began, in order and without gaps. */
  onMeasures(measures: EngineMeasure[]): void;
  /** Play ended by itself, at the end of a song that does not repeat. */
  onEnded(): void;
  /** The engine has taken the sound last sent for this slot. */
  onSound(slot: number): void;
  /** How loud the output is now, from 0. */
  onLevel(level: number): void;
  /**
   * The engine was made again, as a native one is when the sound device
   * changes, and has been told nothing: not the beat, and not to play.
   */
  onReset(): void;
}

export interface EngineAssets {
  workletUrl: string;
  wasmBytes: ArrayBuffer;
}

interface EngineAudioBase {
  readonly status: AudioState;
  /** The rate the engine runs at, once it is ready. */
  readonly sampleRate: number | null;
  readonly isReady: boolean;
  /** Starts audio. Called from a user gesture, and again to resume. */
  start(assets: () => Promise<EngineAssets>): Promise<void>;
  setTracks(tracks: EngineTrack[]): void;
  setMix(plain: number, accented: number, master: number): void;
  setPatterns(patterns: Array<{ index: number; pattern: EnginePattern }>): void;
  setTempo(bpm: number): void;
  setPanel(panel: EnginePanel): void;
  cue(pattern: number): void;
  setEffect(effect: EngineEffect): void;
  setSong(rhythms: number[], loop: boolean): void;
  armFill(armed: boolean): void;
  play(): void;
  stop(): void;
  trigger(track: number, accent: boolean): void;
  dispose(): Promise<void>;
}

/** An engine handed each sound as samples made on the page: the worklet's. */
export interface SampledEngineAudio extends EngineAudioBase {
  /** One slot's samples. The buffer is transferred, so pass a copy. */
  setSound(slot: number, pcm: Float32Array, channels: number, sampleRate: number): void;
  synthSound?: undefined;
}

/** An engine that makes each sound itself from its knobs, at its own rate: a native one. */
export interface SynthEngineAudio extends EngineAudioBase {
  synthSound(sound: SynthSound): void;
  setSound?: undefined;
}

/**
 * What the runtime asks of whatever plays the engine. `AudioController` is
 * the page's own; a shell with a native engine hands in another.
 */
export type EngineAudio = SampledEngineAudio | SynthEngineAudio;

/** Makes the controller a runtime plays through, given where its reports go. */
export type AudioFactory = (events: AudioControllerEvents) => EngineAudio;

/** The commands every engine takes the same way. A controller says how they travel. */
export abstract class EngineCommands {
  protected abstract post(command: SharedEngineCommand): void;

  setTracks(tracks: EngineTrack[]): void {
    this.post({ type: 'tracks', tracks });
  }

  setMix(plain: number, accented: number, master: number): void {
    this.post({ type: 'mix', plain, accented, master });
  }

  setPatterns(patterns: Array<{ index: number; pattern: EnginePattern }>): void {
    if (patterns.length > 0) this.post({ type: 'patterns', patterns });
  }

  setTempo(bpm: number): void {
    this.post({ type: 'tempo', bpm });
  }

  /** What the panel asks the engine to play. A change is read at the next bar line. */
  setPanel(panel: EnginePanel): void {
    this.post({ type: 'panel', panel });
  }

  /** One pattern of the bank, round and round. A change is read at the next bar line. */
  cue(pattern: number): void {
    this.post({ type: 'cue', pattern });
  }

  /** The rhythm of each measure of a rhythm track. Empty goes back to what the panel asks for. */
  setSong(rhythms: number[], loop: boolean): void {
    this.post({ type: 'song', rhythms, loop });
  }

  /** TAP in manual play: the intro/fill-in plays once. */
  armFill(armed: boolean): void {
    this.post({ type: 'fill', armed });
  }

  play(): void {
    this.post({ type: 'play' });
  }

  stop(): void {
    this.post({ type: 'stop' });
  }

  trigger(track: number, accent: boolean): void {
    this.post({ type: 'trigger', track, accent });
  }
}

/** Hands a report about the engine at work to whoever listens. Starting and failing are a controller's own business. */
export function deliverReport(
  report: Exclude<EngineReport, { type: 'ready' | 'error' }>,
  events: AudioControllerEvents,
): void {
  switch (report.type) {
    case 'position':
      events.onPosition(report.step, report.pattern, report.playing);
      break;
    case 'stats':
      events.onStats(report);
      break;
    case 'measures':
      events.onMeasures(report.measures);
      break;
    case 'ended':
      events.onEnded();
      break;
    case 'sound':
      events.onSound(report.slot);
      break;
    case 'level':
      events.onLevel(report.level);
      break;
  }
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

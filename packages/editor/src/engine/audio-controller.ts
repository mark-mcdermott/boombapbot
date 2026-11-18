import {
  PROCESSOR_NAME,
  type EngineCommand,
  type EngineReport,
  type ProcessorOptions,
} from './messages';
import type { EngineEffect, EngineMeasure, EnginePanel, EnginePattern, EngineTrack } from './wasm-engine';

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
  /** The worklet has taken the sound last sent for this slot. */
  onSound(slot: number): void;
  /** How loud the output is now, from 0. */
  onLevel(level: number): void;
}

export interface EngineAssets {
  workletUrl: string;
  wasmBytes: ArrayBuffer;
}

/**
 * Owns the AudioContext and the engine worklet node. Everything that crosses
 * to the audio thread goes through `post`, so the UI never blocks on audio and
 * audio never waits on the UI or the network.
 */
export class AudioController {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private state: AudioState = 'idle';
  private starting: Promise<void> | null = null;
  private readonly events: AudioControllerEvents;

  constructor(events: AudioControllerEvents) {
    this.events = events;
  }

  get status(): AudioState {
    return this.state;
  }

  get sampleRate(): number | null {
    return this.context?.sampleRate ?? null;
  }

  get isReady(): boolean {
    return this.node !== null;
  }

  private setState(state: AudioState, error: string | null = null): void {
    this.state = state;
    this.events.onState(state, error);
  }

  /**
   * Starts audio. Must be called from a user gesture: browsers only let an
   * AudioContext run after one. Safe to call again; later calls resume.
   */
  start(assets: () => Promise<EngineAssets>): Promise<void> {
    if (this.node && this.context) {
      return this.context.state === 'running' ? Promise.resolve() : this.resume();
    }
    if (this.starting) return this.starting;

    let context: AudioContext;
    try {
      // Created synchronously inside the gesture.
      context = new AudioContext({ latencyHint: 'interactive' });
    } catch (error) {
      this.setState('error', describe(error));
      return Promise.reject(error);
    }
    this.context = context;
    this.setState('starting');
    void context.resume().catch(() => undefined);

    this.starting = (async () => {
      try {
        const { workletUrl, wasmBytes } = await assets();
        await context.audioWorklet.addModule(workletUrl);
        const options: ProcessorOptions = { wasmBytes };
        const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: options,
        });
        await new Promise<void>((resolve, reject) => {
          node.port.onmessage = (event: MessageEvent<EngineReport>) => {
            const report = event.data;
            if (report.type === 'ready') resolve();
            else if (report.type === 'error') reject(new Error(report.message));
          };
          node.onprocessorerror = () => reject(new Error('The audio engine failed to start.'));
        });
        node.port.onmessage = (event: MessageEvent<EngineReport>) => this.receive(event.data);
        node.onprocessorerror = () => this.setState('error', 'The audio engine stopped unexpectedly.');
        node.connect(context.destination);
        this.node = node;
        context.onstatechange = () => this.syncContextState();
        if (context.state !== 'running') await context.resume();
        this.syncContextState();
      } catch (error) {
        this.node = null;
        this.context = null;
        void context.close().catch(() => undefined);
        this.setState('error', describe(error));
        throw error;
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  private syncContextState(): void {
    if (!this.context || !this.node) return;
    this.setState(this.context.state === 'running' ? 'running' : 'suspended');
  }

  async resume(): Promise<void> {
    if (!this.context) return;
    await this.context.resume();
    this.syncContextState();
  }

  private receive(report: EngineReport): void {
    switch (report.type) {
      case 'position':
        this.events.onPosition(report.step, report.pattern, report.playing);
        break;
      case 'stats':
        this.events.onStats(report);
        break;
      case 'measures':
        this.events.onMeasures(report.measures);
        break;
      case 'ended':
        this.events.onEnded();
        break;
      case 'sound':
        this.events.onSound(report.slot);
        break;
      case 'level':
        this.events.onLevel(report.level);
        break;
      case 'error':
        this.setState('error', report.message);
        break;
      case 'ready':
        break;
    }
  }

  private post(command: EngineCommand, transfer: Transferable[] = []): void {
    this.node?.port.postMessage(command, transfer);
  }

  /** Sends one slot's sound. The buffer is transferred, so pass a copy. */
  setSound(slot: number, pcm: Float32Array, channels: number, sampleRate: number): void {
    this.post({ type: 'sound', slot, pcm, channels, sampleRate }, [pcm.buffer]);
  }

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

  setEffect(effect: EngineEffect): void {
    this.post({ type: 'effect', effect });
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

  async dispose(): Promise<void> {
    const context = this.context;
    this.node?.disconnect();
    this.node = null;
    this.context = null;
    this.setState('idle');
    if (context) await context.close().catch(() => undefined);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

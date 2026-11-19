import {
  EngineCommands,
  deliverReport,
  describe,
  type AudioControllerEvents,
  type AudioState,
  type EngineAssets,
  type SampledEngineAudio,
} from './engine-audio';
import {
  PROCESSOR_NAME,
  type EngineCommand,
  type EngineReport,
  type ProcessorOptions,
} from './messages';
import type { EngineEffect } from './wasm-engine';

/**
 * Owns the AudioContext and the engine worklet node. Everything that crosses
 * to the audio thread goes through `post`, so the UI never blocks on audio and
 * audio never waits on the UI or the network.
 */
export class AudioController extends EngineCommands implements SampledEngineAudio {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private state: AudioState = 'idle';
  private starting: Promise<void> | null = null;
  private readonly events: AudioControllerEvents;

  constructor(events: AudioControllerEvents) {
    super();
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
      case 'error':
        this.setState('error', report.message);
        break;
      case 'ready':
        break;
      default:
        deliverReport(report, this.events);
    }
  }

  protected post(command: EngineCommand, transfer: Transferable[] = []): void {
    this.node?.port.postMessage(command, transfer);
  }

  /** Sends one slot's sound. The buffer is transferred, so pass a copy. */
  setSound(slot: number, pcm: Float32Array, channels: number, sampleRate: number): void {
    this.post({ type: 'sound', slot, pcm, channels, sampleRate }, [pcm.buffer]);
  }

  setEffect(effect: EngineEffect): void {
    this.post({ type: 'effect', effect });
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

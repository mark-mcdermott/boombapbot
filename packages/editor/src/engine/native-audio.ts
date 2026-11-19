import {
  EngineCommands,
  deliverReport,
  describe,
  type AudioControllerEvents,
  type AudioState,
  type SynthEngineAudio,
} from './engine-audio';
import type { EngineReport, NativeEngineCommand } from './messages';
import { EFFECT, type EngineEffect, type SynthSound } from './wasm-engine';

/** How a shell carries the engine's messages to its native engine and back. */
export interface NativeEngineBridge {
  /** Opens the sound device and makes the engine at its rate. Asked again after an error. */
  open(): Promise<{ sampleRate: number }>;
  /** Hands the engine these commands, in this order. */
  send(commands: NativeEngineCommand[]): Promise<void>;
  /** Every report from the engine, until the function it answers with is called. */
  listen(onReport: (report: EngineReport) => void): Promise<() => void>;
  close(): Promise<void>;
}

/**
 * Plays through an engine a shell runs natively, in place of the page's
 * worklet. One call to the bridge is under way at a time and whatever is
 * asked meanwhile goes together in the next, so the engine hears the
 * commands in the order they were given.
 */
export class NativeAudioController extends EngineCommands implements SynthEngineAudio {
  private state: AudioState = 'idle';
  private rate: number | null = null;
  private opening: Promise<void> | null = null;
  private unlisten: (() => void) | null = null;
  private waiting: NativeEngineCommand[] = [];
  private sending = false;

  constructor(
    private readonly bridge: NativeEngineBridge,
    private readonly events: AudioControllerEvents,
  ) {
    super();
  }

  get status(): AudioState {
    return this.state;
  }

  get sampleRate(): number | null {
    return this.rate;
  }

  get isReady(): boolean {
    return this.rate !== null;
  }

  private setState(state: AudioState, error: string | null = null): void {
    this.state = state;
    this.events.onState(state, error);
  }

  /** Opens the engine. Safe to call again: it opens once, and again after an error. */
  start(): Promise<void> {
    if (this.isReady) return Promise.resolve();
    if (this.opening) return this.opening;
    this.setState('starting');
    this.opening = (async () => {
      try {
        this.unlisten ??= await this.bridge.listen((report) => this.receive(report));
        const { sampleRate } = await this.bridge.open();
        this.rate = sampleRate;
        this.setState('running');
      } catch (error) {
        this.fail(describe(error));
        throw error;
      } finally {
        this.opening = null;
      }
    })();
    return this.opening;
  }

  private fail(message: string): void {
    this.rate = null;
    this.waiting = [];
    this.setState('error', message);
  }

  private receive(report: EngineReport): void {
    switch (report.type) {
      case 'ready':
        // While opening, the answer to `open` says the same.
        if (this.opening) return;
        this.rate = report.sampleRate;
        this.setState('running');
        this.events.onReset();
        break;
      case 'error':
        this.fail(report.message);
        break;
      default:
        deliverReport(report, this.events);
    }
  }

  protected post(command: NativeEngineCommand): void {
    if (!this.isReady) return;
    this.waiting.push(command);
    if (!this.sending) void this.sendWaiting();
  }

  private async sendWaiting(): Promise<void> {
    this.sending = true;
    try {
      while (this.waiting.length > 0) {
        const commands = this.waiting;
        this.waiting = [];
        await this.bridge.send(commands);
      }
    } catch (error) {
      this.fail(describe(error));
    } finally {
      this.sending = false;
    }
  }

  synthSound(sound: SynthSound): void {
    this.post({ type: 'synth', sound });
  }

  setEffect(effect: EngineEffect): void {
    this.post({ type: 'effect', effect: EFFECT[effect.kind], wet: effect.wet });
  }

  async dispose(): Promise<void> {
    this.unlisten?.();
    this.unlisten = null;
    this.rate = null;
    this.waiting = [];
    this.setState('idle');
    await this.bridge.close().catch(() => undefined);
  }
}

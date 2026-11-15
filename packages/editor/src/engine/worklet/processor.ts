/**
 * AudioWorklet processor. Runs the WebAssembly engine on the audio thread.
 *
 * This file is bundled on its own (scripts/prepare-assets.mjs) and loaded with
 * audioWorklet.addModule. All scheduling happens inside the engine against the
 * audio sample clock; the main thread only sends edits and transport commands.
 * Sample decoding happens on the main thread and arrives here as transferred
 * buffers, outside process().
 */
import { PROCESSOR_NAME, type EngineCommand, type EngineReport, type ProcessorOptions } from '../messages';
import { SnareWasm, type WasmEngine } from '../wasm-engine';

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

const MAX_QUANTUM = 2048;
const STATS_SECONDS = 0.1;

class BoombapbotProcessor extends AudioWorkletProcessor {
  private engine: WasmEngine | null = null;
  private lastStep = -1;
  private lastPlaying = false;
  private peak = 0;
  private peakEver = 0;
  private framesSinceStats = 0;
  private readonly scratch = new Float32Array(MAX_QUANTUM);

  constructor(options: { processorOptions: ProcessorOptions }) {
    super();
    this.port.onmessage = (event: MessageEvent<EngineCommand>) => this.handle(event.data);
    try {
      const wasm = SnareWasm.fromBytes(options.processorOptions.wasmBytes);
      this.engine = wasm.createEngine(sampleRate, MAX_QUANTUM);
      this.report({ type: 'ready', sampleRate });
    } catch (error) {
      this.report({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  private report(message: EngineReport): void {
    this.port.postMessage(message);
  }

  private handle(command: EngineCommand): void {
    const engine = this.engine;
    if (!engine) return;
    try {
      switch (command.type) {
        case 'kit':
          engine.loadKit(command.voices);
          engine.collect();
          this.report({ type: 'kit', id: command.id });
          break;
        case 'sound':
          engine.setSound(command.slot, command.pcm, command.channels, command.sampleRate);
          this.report({ type: 'sound', slot: command.slot });
          break;
        case 'pattern':
          command.rows.forEach((row, role) => engine.setRow(role, row));
          break;
        case 'tempo':
          engine.setTempo(command.bpm);
          break;
        case 'swing':
          engine.setSwing(command.swing);
          break;
        case 'play':
          engine.play();
          break;
        case 'stop':
          engine.stop();
          break;
        case 'trigger':
          engine.trigger(command.role, command.velocity);
          break;
        case 'collect':
          engine.collect();
          break;
      }
    } catch (error) {
      this.report({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const engine = this.engine;
    const output = outputs[0];
    if (!engine || !output || !output[0]) return true;
    const left = output[0];
    const right = output[1] ?? this.scratch;
    const frames = Math.min(left.length, MAX_QUANTUM);
    engine.render(left, right, frames);

    let peak = this.peak;
    for (let i = 0; i < frames; i += 1) {
      const a = Math.abs(left[i]!);
      const b = Math.abs(right[i]!);
      if (a > peak) peak = a;
      if (b > peak) peak = b;
    }
    this.peak = peak;

    const step = engine.currentStep;
    const playing = engine.playing;
    if (step !== this.lastStep || playing !== this.lastPlaying) {
      this.lastStep = step;
      this.lastPlaying = playing;
      this.report({ type: 'position', step, playing });
    }

    this.framesSinceStats += frames;
    if (this.framesSinceStats >= sampleRate * STATS_SECONDS) {
      this.framesSinceStats = 0;
      if (peak > this.peakEver) this.peakEver = peak;
      this.report({
        type: 'stats',
        frames: engine.framesRendered,
        peak,
        peakEver: this.peakEver,
        voices: engine.activeVoices,
        stolen: engine.stolenVoices,
      });
      this.peak = 0;
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, BoombapbotProcessor);

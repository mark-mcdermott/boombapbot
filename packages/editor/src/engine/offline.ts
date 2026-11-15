import { tempoBpm, type Project } from '@boombapbot/contracts';
import { applyProject, enginePatterns, midiVelocities, trackNotes } from './machine';
import type { EngineEvent, SnareWasm } from './wasm-engine';

export interface LoopRender {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** Hits inside the returned loop, with frames relative to its start. */
  events: EngineEvent[];
}

/**
 * Renders one seamless loop of a pattern with a separate engine instance,
 * using the same scheduler and voices as live playback. Two measures are
 * played and the second is returned, so tails from the end of the measure
 * wrap into its start.
 */
export function renderLoop(wasm: SnareWasm, project: Project, pattern: number, sampleRate: number): LoopRender {
  const blockSize = 1024;
  const engine = wasm.createEngine(sampleRate, blockSize);
  try {
    engine.enableEventLog(1024);
    applyProject(engine, project);
    engine.cuePattern(pattern);
    engine.playMeasures(2);

    const ticks = wasm.patternTicks(enginePatterns(project.rhythms)[pattern]!);
    const bpm = tempoBpm(project.tempo);
    const start = wasm.tickFrame(ticks, bpm, sampleRate);
    const end = wasm.tickFrame(ticks * 2, bpm, sampleRate);
    const left = new Float32Array(end - start);
    const right = new Float32Array(end - start);
    const blockLeft = new Float32Array(blockSize);
    const blockRight = new Float32Array(blockSize);
    for (let done = 0; done < end; ) {
      const count = Math.min(blockSize, end - done);
      engine.render(blockLeft, blockRight, count);
      // Keep only the second measure.
      const from = Math.max(done, start);
      if (done + count > start) {
        const skip = from - done;
        left.set(blockLeft.subarray(skip, count), from - start);
        right.set(blockRight.subarray(skip, count), from - start);
      }
      done += count;
    }

    const events = engine
      .readEvents()
      .filter((event) => event.frame >= start)
      .map((event) => ({ ...event, frame: event.frame - start }));
    return { left, right, sampleRate, events };
  } finally {
    engine.destroy();
  }
}

/** Standard MIDI File of measures of the project's patterns: Type 1, drums on channel 10. */
export function exportMidi(wasm: SnareWasm, project: Project, sequence: number[]): Uint8Array {
  return wasm.midiExport(
    enginePatterns(project.rhythms),
    sequence,
    trackNotes(project.sound),
    midiVelocities(project.sound),
    tempoBpm(project.tempo),
  );
}

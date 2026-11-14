import { ROLES, type Project } from '@boombapbot/contracts';
import type { DecodedKit } from './kit-loader';
import { SNARE_STEPS, type EngineEvent, type SnareWasm } from './wasm-engine';

export interface LoopRender {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** Hits inside the returned loop, with frames relative to its start. */
  events: EngineEvent[];
}

/** Velocity rows in engine role order. */
export function patternRows(project: Project): number[][] {
  return ROLES.map((role) => {
    const lane = project.pattern.lanes.find((candidate) => candidate.role === role.id);
    return lane ? lane.steps.slice(0, SNARE_STEPS) : new Array<number>(SNARE_STEPS).fill(0);
  });
}

/**
 * Renders one seamless loop with a separate engine instance, using the same
 * scheduler and voices as live playback. Two bars are played and the second
 * is returned, so tails from the end of the bar wrap into its start.
 */
export function renderLoop(
  wasm: SnareWasm,
  project: Project,
  kit: DecodedKit,
  sampleRate: number,
): LoopRender {
  const blockSize = 1024;
  const engine = wasm.createEngine(sampleRate, blockSize);
  try {
    engine.enableEventLog(1024);
    engine.loadKit(kit.voices);
    engine.setTempo(project.bpm);
    engine.setSwing(project.swing);
    patternRows(project).forEach((row, role) => engine.setRow(role, row));
    engine.playLoops(2);

    const loopFrames = wasm.loopFrames(project.bpm, sampleRate);
    const left = new Float32Array(loopFrames);
    const right = new Float32Array(loopFrames);
    const blockLeft = new Float32Array(blockSize);
    const blockRight = new Float32Array(blockSize);
    for (let done = 0; done < loopFrames * 2; ) {
      const count = Math.min(blockSize, loopFrames * 2 - done);
      engine.render(blockLeft, blockRight, count);
      // Keep only the second bar.
      const from = Math.max(done, loopFrames);
      if (done + count > loopFrames) {
        const skip = from - done;
        left.set(blockLeft.subarray(skip, count), from - loopFrames);
        right.set(blockRight.subarray(skip, count), from - loopFrames);
      }
      done += count;
    }

    const events = engine
      .readEvents()
      .filter((event) => event.frame >= loopFrames)
      .map((event) => ({ ...event, frame: event.frame - loopFrames }));
    return { left, right, sampleRate, events };
  } finally {
    engine.destroy();
  }
}

/** Standard MIDI File for the project's pattern: Type 1, drums on channel 10. */
export function exportMidi(wasm: SnareWasm, project: Project): Uint8Array {
  return wasm.midiExport(
    patternRows(project),
    ROLES.map((role) => role.gmNote),
    project.bpm,
    project.swing,
  );
}

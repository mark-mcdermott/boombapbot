import { applySetup, type EngineSetup, type ExportPlan, type RenderPlan } from './setup';
import type { EngineEvent, SnareWasm } from './wasm-engine';

export interface LoopRender {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** Hits inside the render, with frames relative to its start. */
  events: EngineEvent[];
}

/** How long a render that does not loop lets its last hits ring. */
const TAIL_SECONDS = 3;
/** A measure has at most 32 steps, and a step can start a hit on every track. */
const STEPS_PER_MEASURE = 32;
/** A rate fine enough to time a measure by. */
const TIMING_RATE = 48_000;

/** The patterns a plan plays, in order. */
export function planPatterns(wasm: SnareWasm, plan: RenderPlan): number[] {
  return wasm.songPatterns(plan.panel, plan.rhythms);
}

/** How long each measure of a plan lasts, in seconds. */
export function measureSeconds(wasm: SnareWasm, setup: EngineSetup, plan: RenderPlan): number[] {
  return planPatterns(wasm, plan).map(
    (pattern) => wasm.tickFrame(wasm.patternTicks(setup.patterns[pattern]!), setup.tempo, TIMING_RATE) / TIMING_RATE,
  );
}

/**
 * Renders measures of a setup with a separate engine instance, using the
 * same sequencer, scheduler and voices as live playback.
 *
 * A loop is played twice and the second pass is returned, so tails from its
 * end wrap into its start. Anything else is played once from silence and
 * given time to ring out.
 */
export function renderSong(wasm: SnareWasm, setup: EngineSetup, plan: RenderPlan, sampleRate: number): LoopRender {
  const blockSize = 1024;
  const engine = wasm.createEngine(sampleRate, blockSize);
  try {
    const passes = plan.loop ? 2 : 1;
    const song = plan.loop ? [...plan.rhythms, ...plan.rhythms] : plan.rhythms;
    engine.enableEventLog(song.length * setup.tracks.length * STEPS_PER_MEASURE);
    applySetup(engine, setup);
    engine.setPanel(plan.panel);
    engine.setSong(song, false);
    engine.play();

    const ticks = planPatterns(wasm, plan).reduce((sum, pattern) => sum + wasm.patternTicks(setup.patterns[pattern]!), 0);
    const start = plan.loop ? wasm.tickFrame(ticks, setup.tempo, sampleRate) : 0;
    const end = wasm.tickFrame(ticks * passes, setup.tempo, sampleRate) + (plan.loop ? 0 : Math.round(TAIL_SECONDS * sampleRate));
    const left = new Float32Array(end - start);
    const right = new Float32Array(end - start);
    const blockLeft = new Float32Array(blockSize);
    const blockRight = new Float32Array(blockSize);
    for (let done = 0; done < end; ) {
      const count = Math.min(blockSize, end - done);
      engine.render(blockLeft, blockRight, count);
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

/** Standard MIDI File of what an export plan plays, one measure after another: Type 1, drums on channel 10. */
export function exportSongMidi(wasm: SnareWasm, setup: EngineSetup, plan: ExportPlan): Uint8Array {
  return wasm.midiExport(setup.patterns, planPatterns(wasm, plan), plan.notes, plan.velocities, setup.tempo);
}

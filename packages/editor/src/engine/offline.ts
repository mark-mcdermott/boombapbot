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

/** The most passes a loop is played to let an effect's tail settle. */
const MAX_LOOP_PASSES = 8;

/**
 * How many times a loop is played before its last pass is kept: twice with
 * nothing ringing on, and once more for every loop length an effect's tail
 * lasts, up to a limit.
 */
export function loopPasses(tailSeconds: number, loopSeconds: number): number {
  return Math.min(MAX_LOOP_PASSES, 1 + Math.max(1, Math.ceil(tailSeconds / loopSeconds)));
}

/**
 * Renders measures of a setup with a separate engine instance, using the
 * same sequencer, scheduler and voices as live playback.
 *
 * A loop is played at least twice and its last pass is returned, so tails
 * from its end wrap into its start; with an effect on, it is played often
 * enough for the effect's tail to have settled. Anything else is played once
 * from silence and given time to ring out, the effect's tail included.
 */
export function renderSong(wasm: SnareWasm, setup: EngineSetup, plan: RenderPlan, sampleRate: number): LoopRender {
  const blockSize = 1024;
  const engine = wasm.createEngine(sampleRate, blockSize);
  try {
    const ticks = planPatterns(wasm, plan).reduce((sum, pattern) => sum + wasm.patternTicks(setup.patterns[pattern]!), 0);
    const tail = setup.effect ? wasm.effectTailSeconds(setup.effect.kind, setup.tempo) : 0;
    const loopSeconds = wasm.tickFrame(ticks, setup.tempo, TIMING_RATE) / TIMING_RATE;
    const passes = plan.loop ? loopPasses(tail, loopSeconds) : 1;
    const song = Array.from({ length: passes }, () => plan.rhythms).flat();
    engine.enableEventLog(song.length * setup.tracks.length * STEPS_PER_MEASURE);
    applySetup(engine, setup);
    engine.setPanel(plan.panel);
    engine.setSong(song, false);
    engine.play();

    // A loop is as long whichever pass of it is kept, so an effect cannot change its length.
    const loopFrames = wasm.tickFrame(ticks * 2, setup.tempo, sampleRate) - wasm.tickFrame(ticks, setup.tempo, sampleRate);
    const start = plan.loop ? wasm.tickFrame(ticks * (passes - 1), setup.tempo, sampleRate) : 0;
    const end = plan.loop
      ? start + loopFrames
      : wasm.tickFrame(ticks, setup.tempo, sampleRate) + Math.round(Math.max(TAIL_SECONDS, tail) * sampleRate);
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
      .filter((event) => event.frame >= start && event.frame < end)
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

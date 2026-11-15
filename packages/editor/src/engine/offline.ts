import { tempoBpm, type Project } from '@boombapbot/contracts';
import { applyProject, enginePatterns, midiVelocities, trackNotes, type RenderPlan } from './machine';
import type { EngineEvent, EnginePanel, SnareWasm } from './wasm-engine';

export interface LoopRender {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** Hits inside the render, with frames relative to its start. */
  events: EngineEvent[];
}

/** How long a render that does not loop lets its last hits ring. */
const TAIL_SECONDS = 3;
/** A step can start eleven hits, and a measure has at most 32 steps. */
const EVENTS_PER_MEASURE = 11 * 32;

/**
 * Renders measures of the project with a separate engine instance, using the
 * same sequencer, scheduler and voices as live playback.
 *
 * A loop is played twice and the second pass is returned, so tails from its
 * end wrap into its start. Anything else is played once from silence and
 * given time to ring out.
 */
export function renderSong(wasm: SnareWasm, project: Project, plan: RenderPlan, sampleRate: number): LoopRender {
  const blockSize = 1024;
  const engine = wasm.createEngine(sampleRate, blockSize);
  try {
    const passes = plan.loop ? 2 : 1;
    const song = plan.loop ? [...plan.rhythms, ...plan.rhythms] : plan.rhythms;
    engine.enableEventLog(song.length * EVENTS_PER_MEASURE);
    applyProject(engine, project);
    engine.setPanel(plan.panel);
    engine.setSong(song, false);
    engine.play();

    const bank = enginePatterns(project.rhythms);
    const ticks = wasm.songPatterns(plan.panel, plan.rhythms).reduce((sum, pattern) => sum + wasm.patternTicks(bank[pattern]!), 0);
    const bpm = tempoBpm(project.tempo);
    const start = plan.loop ? wasm.tickFrame(ticks, bpm, sampleRate) : 0;
    const end = wasm.tickFrame(ticks * passes, bpm, sampleRate) + (plan.loop ? 0 : Math.round(TAIL_SECONDS * sampleRate));
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

/** The switches that make a song of one rhythm play exactly this pattern. */
function panelFor(pattern: number): EnginePanel {
  const variation = pattern % 2 === 1 ? 'b' : 'a';
  return {
    rhythm: pattern >> 1,
    variation,
    fillRhythm: pattern >> 1,
    fillVariation: variation,
    autoFill: 0,
    firstBeatRule: false,
  };
}

/** One seamless loop of a single pattern of the bank. */
export function renderLoop(wasm: SnareWasm, project: Project, pattern: number, sampleRate: number): LoopRender {
  return renderSong(wasm, project, { panel: panelFor(pattern), rhythms: [pattern >> 1], loop: true }, sampleRate);
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

/** Standard MIDI File of what a render plan plays, one measure after another. */
export function exportSongMidi(wasm: SnareWasm, project: Project, plan: RenderPlan): Uint8Array {
  return exportMidi(wasm, project, wasm.songPatterns(plan.panel, plan.rhythms));
}

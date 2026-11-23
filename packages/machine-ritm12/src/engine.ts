import type { EngineSetup, ExportPlan, PatternPlan } from '@boombapbot/editor/engine';
import {
  VOICES,
  accentGains,
  engineSwing,
  levelGain,
  masterGain,
  rowMask,
  isPaidEffect,
  stepsPerBeat,
  type Pattern,
  type Project,
  type Size,
} from './document';

/** РИТМ-12's project document as the engine takes it. */

/** Tracks the engine has. The accents are track 0, the eight voices follow, and the rest are unused. */
const ENGINE_TRACKS = 12;

/** One pattern of the bank: the accents, then a row for each voice. */
function enginePattern(pattern: Pattern, size: Size, swing: number) {
  const rows = [rowMask(pattern.accents), ...VOICES.map((voice) => rowMask(pattern.steps[voice.id]))];
  return {
    rows: [...rows, ...Array.from({ length: ENGINE_TRACKS - rows.length }, () => 0)],
    firstLength: size,
    secondLength: 0,
    stepsPerBeat: stepsPerBeat(size),
    swing: engineSwing(swing),
  };
}

/**
 * Everything the engine is asked for, for one project. An effect of the
 * upgrade is asked for only where the upgrade is held; anywhere else the
 * beat plays without it, and is never refused.
 */
export function engineSetup(project: Project, { upgraded = false }: { upgraded?: boolean } = {}): EngineSetup {
  const { mix, effect } = project;
  const heard = effect.mix > 0 && (upgraded || !isPaidEffect(effect.kind));
  return {
    tempo: project.tempo,
    sounds: VOICES.map((voice) => {
      const knobs = project.voices[voice.id];
      // The engine's knobs are named for its first machine. This one has no fourth.
      return { sound: voice.index, tune: knobs.pitch, tone: knobs.tone, decay: knobs.decay, snappy: 0.5 };
    }),
    tracks: VOICES.map((voice) => ({
      track: voice.index + 1,
      slot: voice.index,
      pan: voice.pan,
      chokeGroup: voice.chokeGroup,
      gain: mix.mutes[voice.id] ? 0 : levelGain(voice.id, mix.levels[voice.id]),
    })),
    accent: accentGains(mix.accent),
    master: masterGain(mix.volume),
    patterns: project.patterns.map((pattern) => enginePattern(pattern, project.size, project.swing)),
    effect: heard ? { kind: effect.kind, wet: effect.mix } : undefined,
    follow: { cue: project.panel.pattern },
  };
}

/** What an export holds: the pattern the panel is on, as a loop. */
export function exportPlan(project: Project): ExportPlan<PatternPlan> {
  const gains = accentGains(project.mix.accent);
  return {
    pattern: project.panel.pattern,
    loop: true,
    notes: [0, ...VOICES.map((voice) => voice.gmNote), ...Array.from({ length: ENGINE_TRACKS - 1 - VOICES.length }, () => 0)],
    velocities: { plain: Math.round(gains.plain * 127), accented: Math.round(gains.accented * 127) },
  };
}

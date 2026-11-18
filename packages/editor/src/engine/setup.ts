import type { EngineEffect, EnginePanel, EnginePattern, EngineTrack, SynthSound, WasmEngine } from './wasm-engine';

/**
 * Everything a machine asks of the engine for one project. Live playback and
 * offline rendering both start from here, so they cannot disagree about what
 * a project sounds like.
 */
export interface EngineSetup {
  tempo: number;
  /** One synthesised sound per slot the machine uses. */
  sounds: SynthSound[];
  tracks: EngineTrack[];
  /** Linear gains of a plain and an accented hit. */
  accent: { plain: number; accented: number };
  master: number;
  /** The pattern bank, in engine order. */
  patterns: EnginePattern[];
  /** The effect on the mix, for a machine that has one. */
  effect?: EngineEffect;
  /** What the engine plays, measure by measure. */
  panel: EnginePanel;
}

/** Measures to render or export: their rhythms, the switches that choose their versions, and whether they loop. */
export interface RenderPlan {
  panel: EnginePanel;
  rhythms: number[];
  loop: boolean;
}

/** A render plan with what a MIDI file needs besides. */
export interface ExportPlan extends RenderPlan {
  /** MIDI note of each engine track. A track with no sound of its own has 0. */
  notes: number[];
  /** MIDI velocities of a plain and an accented hit. */
  velocities: { plain: number; accented: number };
}

/** Whether two flat records hold the same values. */
export function sameValues<Value extends object>(a: Value, b: Value): boolean {
  const keys = Object.keys(a) as Array<keyof Value>;
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

export function samePattern(a: EnginePattern, b: EnginePattern): boolean {
  return (
    a.firstLength === b.firstLength &&
    a.secondLength === b.secondLength &&
    a.stepsPerBeat === b.stepsPerBeat &&
    a.swing === b.swing &&
    a.rows.length === b.rows.length &&
    a.rows.every((row, index) => row === b.rows[index])
  );
}

/** Loads a whole setup into an engine, synthesising its sounds at the engine's rate. */
export function applySetup(engine: WasmEngine, setup: EngineSetup): void {
  for (const sound of setup.sounds) engine.synthSound(sound);
  setup.tracks.forEach((track) => engine.setTrack(track));
  engine.setAccent(setup.accent.plain, setup.accent.accented);
  engine.setMasterVolume(setup.master);
  engine.setTempo(setup.tempo);
  setup.patterns.forEach((pattern, index) => engine.setPattern(index, pattern));
  if (setup.effect) engine.setEffect(setup.effect);
}

import {
  INSTRUMENT_IDS,
  PATTERN_COUNT,
  ROLES,
  TRACKS,
  accentGains,
  getTrack,
  isSwitched,
  levelGain,
  masterGain,
  patternIndex,
  rowMask,
  stepsPerBeat,
  tempoBpm,
  trackRole,
  type InstrumentId,
  type Project,
  type Rhythm,
  type Role,
  type SoundSettings,
  type TrackId,
  type Variation,
} from '@boombapbot/contracts';
import type { EnginePattern, EngineTrack, SynthSound, WasmEngine } from './wasm-engine';

/**
 * The project document as the engine takes it. Live playback and offline
 * rendering both go through here, so they cannot disagree about what a
 * project sounds like.
 */

/** The instrument whose panel column a sound belongs to. */
const OWNERS = new Map<number, InstrumentId>(
  INSTRUMENT_IDS.flatMap((id) => {
    const track = getTrack(id);
    return [track.sound, track.alternate]
      .filter((role) => role !== undefined)
      .map((role) => [ROLES.find((candidate) => candidate.id === role)!.index, id] as const);
  }),
);

export function soundOwner(role: Role): InstrumentId {
  const owner = OWNERS.get(role.index);
  if (!owner) throw new Error(`no track plays ${role.id}`);
  return owner;
}

/** A sound and the knobs of its column. A tom and its conga share a tuning knob. */
export function synthSound(role: Role, sound: SoundSettings): SynthSound {
  return { sound: role.index, ...sound.knobs[soundOwner(role)] };
}

function isAlternate(id: InstrumentId, sound: SoundSettings): boolean {
  return isSwitched(id) && sound.alternates[id];
}

/** The sound each instrument plays now, given its voice switch. */
export function instrumentRole(id: InstrumentId, sound: SoundSettings): Role {
  return trackRole(id, isAlternate(id, sound));
}

/** What a track is called now: the sound its voice switch selects. */
export function trackLabel(id: TrackId, sound: SoundSettings): string {
  return id === 'accent' ? getTrack(id).label : instrumentRole(id, sound).name;
}

export function engineTracks(sound: SoundSettings): EngineTrack[] {
  return INSTRUMENT_IDS.map((id) => {
    const track = getTrack(id);
    return {
      track: track.index,
      slot: instrumentRole(id, sound).index,
      pan: track.pan,
      chokeGroup: track.chokeGroup,
      gain: levelGain(id, sound.levels[id]),
    };
  });
}

export function engineMix(sound: SoundSettings): { plain: number; accented: number; master: number } {
  return { ...accentGains(sound.accent), master: masterGain(sound.master) };
}

export function enginePattern(rhythm: Rhythm, variation: Variation): EnginePattern {
  return {
    rows: TRACKS.map((track) => rowMask(rhythm[variation][track.id])),
    firstLength: rhythm.firstLength,
    secondLength: rhythm.secondLength,
    stepsPerBeat: stepsPerBeat(rhythm.preScale),
  };
}

/** Both versions of a rhythm, with where the engine keeps them. */
export function rhythmPatterns(rhythm: Rhythm, index: number): Array<{ index: number; pattern: EnginePattern }> {
  return (['a', 'b'] as const).map((variation) => ({
    index: patternIndex(index, variation),
    pattern: enginePattern(rhythm, variation),
  }));
}

/** The whole pattern bank, in engine order. */
export function enginePatterns(rhythms: Rhythm[]): EnginePattern[] {
  const bank = rhythms.flatMap((rhythm, index) => rhythmPatterns(rhythm, index).map((entry) => entry.pattern));
  if (bank.length !== PATTERN_COUNT) throw new Error(`a project has ${PATTERN_COUNT} patterns, not ${bank.length}`);
  return bank;
}

/** The version of the selected Basic Rhythm that the step buttons show. */
export function selectedVariation(project: Project): Variation {
  return project.panel.basicVariation === 'b' ? 'b' : 'a';
}

/** The pattern the selected Basic Rhythm plays. */
export function selectedPattern(project: Project): number {
  return patternIndex(project.panel.basicRhythm, selectedVariation(project));
}

/** MIDI note of each track, for the sounds its switches select. The accent has none. */
export function trackNotes(sound: SoundSettings): number[] {
  return TRACKS.map((track) => (track.id === 'accent' ? 0 : instrumentRole(track.id, sound).gmNote));
}

/** MIDI velocities of a plain and an accented hit. */
export function midiVelocities(sound: SoundSettings): { plain: number; accented: number } {
  const gains = accentGains(sound.accent);
  return { plain: Math.round(gains.plain * 127), accented: Math.round(gains.accented * 127) };
}

/** Loads a whole project into an engine, synthesising its sounds at the engine's rate. */
export function applyProject(engine: WasmEngine, project: Project): void {
  const { sound } = project;
  for (const role of ROLES) engine.synthSound(synthSound(role, sound));
  engineTracks(sound).forEach((track) => engine.setTrack(track));
  const mix = engineMix(sound);
  engine.setAccent(mix.plain, mix.accented);
  engine.setMasterVolume(mix.master);
  engine.setTempo(tempoBpm(project.tempo));
  enginePatterns(project.rhythms).forEach((pattern, index) => engine.setPattern(index, pattern));
}

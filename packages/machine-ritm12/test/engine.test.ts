import { describe, expect, it } from 'vitest';
import { exportSongMidi, renderSong } from '@boombapbot/editor/engine';
import { loadWasm, parseMidi, rms } from '../../editor/test/helpers';
import { VOICES, countHits, levelGain } from '../src/document';
import { engineSetup, exportPlan } from '../src/engine';
import { newProject } from './helpers';

const wasm = loadWasm('ritm12');

describe('what РИТМ-12 asks of the engine', () => {
  it('gives each voice its own track, slot and sound, with the accents on track 0', () => {
    const project = newProject();
    const setup = engineSetup(project);
    expect(setup.tempo).toBe(104);
    expect(setup.tracks.map((track) => [track.track, track.slot])).toEqual(VOICES.map((voice) => [voice.index + 1, voice.index]));
    expect(setup.sounds.map((sound) => sound.sound)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(setup.tracks[3]!.chokeGroup).toBe(setup.tracks[4]!.chokeGroup);
    expect(setup.tracks[0]!.gain).toBeCloseTo(levelGain('kick', 0.75), 10);
    expect(setup.patterns).toHaveLength(4);
    expect(setup.patterns[0]).toMatchObject({ firstLength: 16, secondLength: 0, stepsPerBeat: 4, swing: 0 });
    expect(setup.patterns[0]!.rows).toHaveLength(12);
    expect(setup.patterns[0]!.rows[0]).toBe(0b0100_0001_0000_0001);
    expect(setup.follow).toEqual({ cue: 0 });
    expect(setup.effect).toBeUndefined();
  });

  it('follows the knobs and switches', () => {
    const project = newProject();
    const changed = engineSetup({
      ...project,
      tempo: 174,
      swing: 0.5,
      size: 12,
      mix: { ...project.mix, mutes: { ...project.mix.mutes, snare: true }, levels: { ...project.mix.levels, kick: 0 } },
      voices: { ...project.voices, tom: { pitch: 0.1, decay: 0.9, tone: 0.3 } },
      effect: { kind: 'reverb', mix: 0.4 },
      panel: { ...project.panel, pattern: 2 },
    });
    expect(changed.tempo).toBe(174);
    expect(changed.patterns[0]).toMatchObject({ firstLength: 12, stepsPerBeat: 3, swing: 64 });
    expect(changed.tracks[0]!.gain).toBe(0);
    expect(changed.tracks[1]!.gain).toBe(0);
    expect(changed.sounds[5]).toEqual({ sound: 5, tune: 0.1, tone: 0.3, decay: 0.9, snappy: 0.5 });
    expect(changed.effect).toEqual({ kind: 'reverb', wet: 0.4 });
    expect(changed.follow).toEqual({ cue: 2 });
  });
});

describe('РИТМ-12 through the engine', () => {
  it('plays the pattern the panel is on, every hit once, as a loop of one measure', () => {
    const project = newProject();
    for (const pattern of [0, 1]) {
      const at = { ...project, panel: { ...project.panel, pattern } };
      const render = renderSong(wasm, engineSetup(at), exportPlan(at), 44100);
      // One measure of four beats at 104.
      expect(render.left.length).toBe(Math.round((4 * 60 * 44100) / 104));
      expect(render.events).toHaveLength(countHits(project.patterns[pattern]!));
      expect(new Set(render.events.map((event) => event.pattern))).toEqual(new Set([pattern]));
      expect(rms(render.left)).toBeGreaterThan(0.02);
    }
  });

  it('accents the steps on its accent row, and plays twelve steps as triplets', () => {
    const project = newProject();
    const render = renderSong(wasm, engineSetup(project), exportPlan(project), 44100);
    const accented = new Set(render.events.filter((event) => event.accent).map((event) => event.step));
    expect(accented).toEqual(new Set([0, 8, 14].filter((step) => render.events.some((event) => event.step === step))));

    const triplets = { ...project, size: 12 as const };
    const short = renderSong(wasm, engineSetup(triplets), exportPlan(triplets), 44100);
    expect(short.left.length).toBe(render.left.length);
    expect(Math.max(...short.events.map((event) => event.step))).toBeLessThan(12);
  });

  it('swings, mutes and adds its effect', () => {
    const project = newProject();
    const plan = exportPlan(project);
    const straight = renderSong(wasm, engineSetup(project), plan, 44100);
    const swung = renderSong(wasm, engineSetup({ ...project, swing: 1 }), plan, 44100);
    const late = swung.events.filter((event, index) => event.frame > straight.events[index]!.frame);
    expect(late.length).toBeGreaterThan(0);
    expect(late.every((event) => event.step % 2 === 1)).toBe(true);

    const everyVoiceMuted = Object.fromEntries(VOICES.map((voice) => [voice.id, true])) as typeof project.mix.mutes;
    const silent = renderSong(wasm, engineSetup({ ...project, mix: { ...project.mix, mutes: everyVoiceMuted } }), plan, 44100);
    expect(rms(silent.left)).toBe(0);

    for (const kind of ['delay', 'reverb', 'flanger', 'chorus'] as const) {
      const wet = renderSong(wasm, engineSetup({ ...project, effect: { kind, mix: 0.6 } }), plan, 44100);
      expect(wet.left.length, kind).toBe(straight.left.length);
      expect(wet.left, kind).not.toEqual(straight.left);
      expect(wet.left.every(Number.isFinite), kind).toBe(true);
    }
  });

  it('exports the pattern as MIDI, a note for each voice and louder where accented', () => {
    const project = newProject();
    const plan = exportPlan(project);
    expect(plan).toMatchObject({ pattern: 0, loop: true });
    expect(plan.notes.slice(0, 9)).toEqual([0, 36, 38, 39, 42, 46, 45, 37, 56]);
    const midi = parseMidi(exportSongMidi(wasm, engineSetup(project), plan));
    const ons = midi.notes.filter((note) => note.on);
    expect(ons).toHaveLength(countHits(project.patterns[0]!));
    expect(new Set(ons.map((note) => note.velocity))).toEqual(new Set([plan.velocities.plain, plan.velocities.accented]));
    expect(plan.velocities.accented).toBeGreaterThan(plan.velocities.plain);
    // Swung, the off-beat notes are written late, as they are played.
    const swung = { ...project, swing: 1 };
    const late = parseMidi(exportSongMidi(wasm, engineSetup(swung), exportPlan(swung))).notes.filter((note) => note.on);
    expect(late.some((note) => note.tick % 120 === 60)).toBe(true);
  });
});

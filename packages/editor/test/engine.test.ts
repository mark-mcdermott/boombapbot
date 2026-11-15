import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ROLES,
  TRACKS,
  countHits,
  getRole,
  isStepOn,
  patternIndex,
  rhythmLength,
  stepsPerBeat,
  tempoBpm,
  tempoFromBpm,
  type Project,
  type Variation,
} from '@boombapbot/contracts';
import {
  decodeWav,
  encodeWav,
  engineMix,
  enginePatterns,
  engineTracks,
  exportMidi,
  midiVelocities,
  renderLoop,
  selectedPattern,
  synthSound,
  trackNotes,
} from '../src/engine';
import { contractsPath, fixturePath, loadFixture, loadWasm, nativeRenderPath, parseMidi, rms } from './helpers';

const wasm = loadWasm();
const fixture = loadFixture();
/** Every version of a rhythm in the fixture that has hits: [rhythm, version]. */
const WRITTEN: Array<[number, Variation]> = [
  [0, 'a'],
  [0, 'b'],
  [1, 'a'],
  [2, 'a'],
  [3, 'a'],
  [12, 'a'],
];

function measureSeconds(project: Project, rhythm: number): number {
  const { preScale } = project.rhythms[rhythm]!;
  return (rhythmLength(project.rhythms[rhythm]!) / stepsPerBeat(preScale)) * (60 / tempoBpm(project.tempo));
}

describe('project to engine', () => {
  it('maps tracks to the sounds their switches select', () => {
    const tracks = engineTracks(fixture.sound);
    expect(tracks.map((track) => track.track)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // The fixture has the rim shot switched to claves and nothing else switched.
    expect(tracks[5]!.slot).toBe(getRole('claves').index);
    expect(tracks[6]!.slot).toBe(getRole('clap').index);
    expect(tracks[9]!.chokeGroup).toBe(tracks[10]!.chokeGroup);
    expect(tracks[9]!.chokeGroup).toBeGreaterThan(0);
    expect(trackNotes(fixture.sound)[6]).toBe(getRole('claves').gmNote);
    expect(trackNotes(fixture.sound)[0]).toBe(0);
  });

  it('turns levels, accent and volume into gains', () => {
    const tracks = engineTracks(fixture.sound);
    // The kick is at its default level, the cowbell turned down.
    expect(tracks[0]!.gain).toBeCloseTo(TRACKS[1]!.trim, 9);
    expect(tracks[7]!.gain).toBeCloseTo(TRACKS[8]!.trim * (0.6 / 0.75) ** 2, 9);
    const mix = engineMix({ ...fixture.sound, accent: 1, master: 1 });
    expect(mix).toEqual({ plain: 0.6, accented: 1, master: 1 });
    expect(engineMix({ ...fixture.sound, accent: 0 }).accented).toBe(0.6);
    expect(midiVelocities({ ...fixture.sound, accent: 1 })).toEqual({ plain: 76, accented: 127 });
  });

  it('gives a sound the knobs of its panel column', () => {
    const sound = { ...fixture.sound, knobs: { ...fixture.sound.knobs, low_tom: { tune: 0.9, tone: 0.5, decay: 0.5, snappy: 0.5 } } };
    expect(synthSound(getRole('low_tom'), sound).tune).toBe(0.9);
    expect(synthSound(getRole('low_conga'), sound).tune).toBe(0.9);
    expect(synthSound(getRole('mid_tom'), sound).tune).toBe(0.5);
    expect(synthSound(getRole('kick'), sound)).toEqual({ sound: 0, tune: 0.5, tone: 0.5, decay: 0.6, snappy: 0.5 });
  });

  it('lays out the pattern bank as the engine indexes it', () => {
    const bank = enginePatterns(fixture.rhythms);
    expect(bank).toHaveLength(32);
    expect(bank[patternIndex(2, 'a')]).toMatchObject({ firstLength: 16, secondLength: 16, stepsPerBeat: 8 });
    expect(bank[patternIndex(1, 'a')]).toMatchObject({ firstLength: 12, secondLength: 0, stepsPerBeat: 3 });
    expect(bank[0]!.rows[0]).toBe(0x101);
    expect(selectedPattern(fixture)).toBe(0);
    expect(selectedPattern({ ...fixture, panel: { ...fixture.panel, basicRhythm: 3, basicVariation: 'b' } })).toBe(7);
    expect(selectedPattern({ ...fixture, panel: { ...fixture.panel, basicRhythm: 3, basicVariation: 'ab' } })).toBe(6);
  });
});

describe('WebAssembly engine', () => {
  it('plays every written rhythm for exactly one measure, hit for hit', () => {
    for (const [rhythm, variation] of WRITTEN) {
      const render = renderLoop(wasm, fixture, patternIndex(rhythm, variation), 44100);
      const entry = fixture.rhythms[rhythm]!;
      expect(render.events).toHaveLength(countHits(entry, variation));
      expect(render.left.length / 44100).toBeCloseTo(measureSeconds(fixture, rhythm), 3);
      expect(rms(render.left)).toBeGreaterThan(0.01);
      expect(rms(render.right)).toBeGreaterThan(0.01);
      for (const event of render.events) {
        expect(event.pattern).toBe(patternIndex(rhythm, variation));
        expect(isStepOn(entry[variation][TRACKS[event.track]!.id], event.step)).toBe(true);
        expect(event.accent).toBe(isStepOn(entry[variation].accent, event.step));
      }
    }
  });

  it('plays the 2nd part after a short 1st part, from its own steps', () => {
    const render = renderLoop(wasm, fixture, patternIndex(3, 'a'), 48000);
    const steps = [...new Set(render.events.map((event) => event.step))];
    expect(Math.max(...steps)).toBeGreaterThanOrEqual(16);
    expect(steps.every((step) => step < 16 || step < 16 + fixture.rhythms[3]!.secondLength)).toBe(true);
    expect(render.events[0]!.frame).toBe(0);
  });

  it('renders a loop of exactly one measure at any tempo or rate', () => {
    for (const sampleRate of [44100, 48000]) {
      for (const bpm of [40, 97, 124, 133, 300]) {
        const project = { ...fixture, tempo: tempoFromBpm(bpm) };
        for (const rhythm of [0, 1, 2, 3]) {
          const render = renderLoop(wasm, project, patternIndex(rhythm, 'a'), sampleRate);
          const pattern = enginePatterns(project.rhythms)[patternIndex(rhythm, 'a')]!;
          const ticks = wasm.patternTicks(pattern);
          const exact = tempoBpm(project.tempo);
          expect(render.left.length).toBe(
            wasm.tickFrame(ticks * 2, exact, sampleRate) - wasm.tickFrame(ticks, exact, sampleRate),
          );
          expect(render.events).toHaveLength(countHits(project.rhythms[rhythm]!, 'a'));
        }
      }
    }
  });

  it('is deterministic', () => {
    const a = renderLoop(wasm, fixture, 4, 44100);
    const b = renderLoop(wasm, fixture, 4, 44100);
    expect(Buffer.from(a.left.buffer).equals(Buffer.from(b.left.buffer))).toBe(true);
  });

  it('plays the alternate sound of a switched track, on the same steps', () => {
    // Rhythm 3 of the fixture has rim shots; the fixture has that track switched to claves.
    const claves = renderLoop(wasm, fixture, patternIndex(2, 'a'), 44100);
    const rimShot = renderLoop(
      wasm,
      { ...fixture, sound: { ...fixture.sound, alternates: { ...fixture.sound.alternates, rim_shot: false } } },
      patternIndex(2, 'a'),
      44100,
    );
    expect(rimShot.events).toEqual(claves.events);
    expect(claves.events.some((event) => event.track === 6)).toBe(true);
    const difference = claves.left.map((sample, index) => sample - rimShot.left[index]!);
    expect(rms(difference)).toBeGreaterThan(0.005);
  });

  it('follows the mix: a level knob, the accent and the master volume', () => {
    const plain = renderLoop(wasm, fixture, 0, 44100);
    const quiet = renderLoop(wasm, { ...fixture, sound: { ...fixture.sound, master: 0.4 } }, 0, 44100);
    expect(rms(quiet.left)).toBeLessThan(rms(plain.left) * 0.5);
    const flat = renderLoop(wasm, { ...fixture, sound: { ...fixture.sound, accent: 0 } }, 0, 44100);
    expect(rms(flat.left)).toBeLessThan(rms(plain.left));
    const muted = {
      ...fixture,
      sound: { ...fixture.sound, levels: { ...fixture.sound.levels, kick: 0 } },
    };
    expect(rms(renderLoop(wasm, muted, 0, 44100).left)).toBeLessThan(rms(plain.left));
    // Hits are where they were, whatever the mix.
    expect(quiet.events).toEqual(plain.events);
  });

  it('matches the native build', () => {
    // Skipped only when the native tool has not been built (pnpm build:engine).
    if (!existsSync(nativeRenderPath)) {
      console.warn('native boombapbot-render not built; skipping native/WASM comparison');
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'boombapbot-'));
    for (const [rhythm, variation] of WRITTEN) {
      const name = `${rhythm}${variation}`;
      const wavPath = join(dir, `${name}.wav`);
      const eventsPath = join(dir, `${name}.json`);
      const midiPath = join(dir, `${name}.mid`);
      execFileSync(nativeRenderPath, [
        '--project', fixturePath,
        '--contracts', contractsPath,
        '--rhythm', String(rhythm),
        '--version', variation,
        '--out', wavPath,
        '--events', eventsPath,
        '--midi', midiPath,
      ]);
      const native = decodeWav(new Uint8Array(readFileSync(wavPath)).buffer as ArrayBuffer);
      const nativeEvents = JSON.parse(readFileSync(eventsPath, 'utf8')) as Array<{
        frame: number;
        step: number;
        track: number;
        accent: number;
        pattern: number;
      }>;
      const pattern = patternIndex(rhythm, variation);
      const render = renderLoop(wasm, fixture, pattern, 44100);

      // Event timing is identical. The native log covers both rendered measures.
      const loopFrames = render.left.length;
      const secondMeasure = nativeEvents
        .filter((event) => event.frame >= loopFrames)
        .map((event) => ({ ...event, accent: event.accent !== 0, frame: event.frame - loopFrames }));
      expect(secondMeasure).toEqual(render.events);

      // Audio agrees to within two 24-bit steps. The only source of difference
      // is the last bit of C library results (exp, tanh, sin, cos) between the
      // native C library and the WebAssembly one.
      expect(native.frames).toBe(loopFrames);
      const encoded = decodeWav(encodeWav(render.left, render.right, 44100, 24).buffer as ArrayBuffer);
      let worst = 0;
      for (let i = 0; i < native.pcm.length; i += 1) {
        worst = Math.max(worst, Math.abs(native.pcm[i]! - encoded.pcm[i]!));
      }
      expect(worst, `rhythm ${name}`).toBeLessThanOrEqual(2 / 8388608);

      // The MIDI file is the same, byte for byte.
      expect(Buffer.from(exportMidi(wasm, fixture, [pattern])).equals(readFileSync(midiPath))).toBe(true);
    }
  });
});

describe('WAV export', () => {
  it('writes one measure of stereo PCM with nonzero audio', () => {
    const render = renderLoop(wasm, fixture, 0, 44100);
    for (const bits of [16, 24] as const) {
      const bytes = encodeWav(render.left, render.right, 44100, bits);
      const decoded = decodeWav(bytes.buffer as ArrayBuffer);
      expect(decoded.channels).toBe(2);
      expect(decoded.sampleRate).toBe(44100);
      expect(decoded.frames).toBe(render.left.length);
      expect(decoded.frames / decoded.sampleRate).toBeCloseTo(measureSeconds(fixture, 0), 3);
      expect(bytes.length).toBe(44 + decoded.frames * 2 * (bits / 8));
      expect(rms(decoded.pcm)).toBeGreaterThan(0.01);
      const tolerance = bits === 16 ? 1 / 32767 : 1 / 8388607;
      expect(Math.abs(decoded.pcm[2000]! - render.left[1000]!)).toBeLessThanOrEqual(tolerance);
    }
  });

  it('rejects files that are not usable samples', () => {
    expect(() => decodeWav(new ArrayBuffer(10))).toThrow(/too short/);
    expect(() => decodeWav(new Uint8Array(64).buffer)).toThrow(/RIFF/);
    const good = encodeWav(new Float32Array(100), new Float32Array(100), 44100, 16);
    const view = new DataView(good.buffer);
    view.setUint16(22, 6, true); // six channels
    expect(() => decodeWav(good.buffer as ArrayBuffer)).toThrow(/mono and stereo/);
  });
});

describe('MIDI export', () => {
  it('writes a Type 1 file with tempo and drum notes on channel 10', () => {
    const midi = parseMidi(exportMidi(wasm, fixture, [0]));
    expect(midi.format).toBe(1);
    expect(midi.trackCount).toBe(2);
    expect(midi.ppq).toBe(480);
    expect(midi.tempoMicros).toBe(Math.floor(60_000_000 / tempoBpm(fixture.tempo) + 0.5));
    expect(midi.trackEnds).toEqual([1920, 1920]);
    expect(midi.signatures).toEqual([[0, 4, 2]]);

    const hits = countHits(fixture.rhythms[0]!, 'a');
    const noteOns = midi.notes.filter((note) => note.on);
    expect(midi.notes).toHaveLength(hits * 2);
    expect(noteOns).toHaveLength(hits);
    expect(midi.notes.every((note) => note.channel === 10)).toBe(true);

    // Every note-on sits on its step's tick, louder where the step is accented.
    const { plain, accented } = midiVelocities(fixture.sound);
    const notes = trackNotes(fixture.sound);
    const rows = fixture.rhythms[0]!.a;
    const expected = TRACKS.slice(1)
      .flatMap((track) =>
        Array.from({ length: 16 }, (_, step) => step)
          .filter((step) => isStepOn(rows[track.id], step))
          .map((step) => ({
            tick: step * 120,
            note: notes[track.index]!,
            velocity: isStepOn(rows.accent, step) ? accented : plain,
          })),
      )
      .sort((a, b) => a.tick - b.tick || a.note - b.note);
    const actual = noteOns
      .map(({ tick, note, velocity }) => ({ tick, note, velocity }))
      .sort((a, b) => a.tick - b.tick || a.note - b.note);
    expect(actual).toEqual(expected);
    expect(accented).toBeGreaterThan(plain);
  });

  it('writes measures of different lengths one after another', () => {
    // Sixteenths, triplets, thirty-seconds and sextuplets: each is four beats.
    const midi = parseMidi(exportMidi(wasm, fixture, [0, 2, 4, 6, 1]));
    expect(midi.trackEnds).toEqual([1920 * 5, 1920 * 5]);
    expect(midi.signatures).toEqual([[0, 4, 2]]);
    const hits = [
      countHits(fixture.rhythms[0]!, 'a'),
      countHits(fixture.rhythms[1]!, 'a'),
      countHits(fixture.rhythms[2]!, 'a'),
      countHits(fixture.rhythms[3]!, 'a'),
      countHits(fixture.rhythms[0]!, 'b'),
    ];
    expect(midi.notes.filter((note) => note.on)).toHaveLength(hits.reduce((sum, count) => sum + count, 0));
  });

  it('places notes on the same timeline as audio', () => {
    for (const pattern of [0, 2, 4, 6]) {
      const midi = parseMidi(exportMidi(wasm, fixture, [pattern]));
      const render = renderLoop(wasm, fixture, pattern, 48000);
      const framesPerTick = (48000 * 60) / tempoBpm(fixture.tempo) / 480;
      const ticks = [...new Set(midi.notes.filter((note) => note.on).map((note) => note.tick))];
      const frames = [...new Set(render.events.map((event) => event.frame))];
      expect(ticks).toHaveLength(frames.length);
      ticks.forEach((tick, i) => {
        // Within one frame of the audio event: MIDI ticks are whole engine ticks.
        expect(Math.abs(tick * framesPerTick - frames[i]!)).toBeLessThanOrEqual(1);
      });
    }
  });

  it('names every sound of the machine', () => {
    expect(new Set(ROLES.map((role) => role.gmNote)).size).toBe(ROLES.length);
  });
});

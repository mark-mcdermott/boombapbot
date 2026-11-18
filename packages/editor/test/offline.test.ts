import { describe, expect, it } from 'vitest';
import {
  applySetup,
  decodeWav,
  encodeWav,
  exportSongMidi,
  loopPasses,
  renderSong,
  type EnginePanel,
  type EnginePattern,
  type EngineSetup,
  type ExportPlan,
  type SongPlan,
} from '../src/engine';
import { loadWasm, parseMidi, rms } from './helpers';

// The offline renderer, the song and panel calls and the exporters, with a
// setup written out by hand. No machine's project is involved: the engine is
// the one built for РИТМ-12 only because an engine is always built for some
// machine, and three of its sounds are all this needs.

const wasm = loadWasm('ritm12');
const RATE = 44100;
const TEMPO = 120;

const pattern = (rows: number[], shape: Partial<Omit<EnginePattern, 'rows'>> = {}): EnginePattern => ({
  rows: [...rows, ...new Array<number>(12 - rows.length).fill(0)],
  firstLength: 16,
  secondLength: 0,
  stepsPerBeat: 4,
  swing: 0,
  ...shape,
});

/** Bits set on every `every`th step of the first `length`. */
const steps = (every: number, length = 16) =>
  Array.from({ length }, (_, step) => (step % every === 0 ? 2 ** step : 0)).reduce((sum, bit) => sum + bit, 0);

const hits = (entry: EnginePattern) =>
  entry.rows.slice(1).reduce((sum, row) => sum + row.toString(2).replaceAll('0', '').length, 0);

// A rhythm is two patterns of the bank, its A and its B version: rhythm r is
// patterns 2r and 2r + 1. Rhythm 12 is the first intro and fill-in.
const A0 = pattern([0b1, steps(4), steps(8) << 4, steps(2)]);
const B0 = pattern([0, steps(4), steps(4) << 2, steps(1)]);
const TRIPLETS = pattern([0, steps(3, 12), 0, steps(1, 12)], { firstLength: 12, stepsPerBeat: 3 });
const TWO_PARTS = pattern([0, steps(8), steps(8) << 4, steps(4) + steps(4) * 2 ** 16], {
  secondLength: 16,
  stepsPerBeat: 8,
});
const FILL = pattern([0, 0, steps(1), 0]);
const EMPTY = pattern([]);
const bank = Array.from({ length: 32 }, () => EMPTY);
bank[0] = A0;
bank[1] = B0;
bank[2] = TRIPLETS;
bank[4] = TWO_PARTS;
bank[24] = FILL;

const panel = (change: Partial<EnginePanel> = {}): EnginePanel => ({
  rhythm: 0,
  variation: 'a',
  fillRhythm: 12,
  fillVariation: 'a',
  autoFill: 0,
  firstBeatRule: false,
  ...change,
});

const setup: EngineSetup = {
  tempo: TEMPO,
  sounds: [0, 1, 3].map((sound) => ({ sound, tune: 0.5, tone: 0.5, decay: 0.5, snappy: 0.5 })),
  tracks: [
    { track: 1, slot: 0, pan: 0, chokeGroup: 0, gain: 0.8 },
    { track: 2, slot: 1, pan: -0.2, chokeGroup: 0, gain: 0.6 },
    { track: 3, slot: 3, pan: 0.2, chokeGroup: 0, gain: 0.4 },
  ],
  accent: { plain: 0.6, accented: 1 },
  master: 0.8,
  patterns: bank,
  follow: { panel: panel() },
};

const song = (rhythms: number[], loop: boolean, change: Partial<EnginePanel> = {}): SongPlan => ({
  panel: panel(change),
  rhythms,
  loop,
});

const forMidi = <Plan extends SongPlan>(plan: Plan): ExportPlan<Plan> => ({
  ...plan,
  notes: [0, 36, 38, 42, 0, 0, 0, 0, 0, 0, 0, 0],
  velocities: { plain: 76, accented: 127 },
});

/** A measure of four beats at this tempo. */
const MEASURE = (4 * 60 * RATE) / TEMPO;

describe('rendering offline', () => {
  it('renders a looped measure as exactly one measure, hit for hit, at any tempo or rate', () => {
    for (const sampleRate of [44100, 48000]) {
      for (const tempo of [40, 97, 133, 300]) {
        for (const index of [0, 2, 4]) {
          const at = { ...setup, tempo };
          const render = renderSong(wasm, at, { pattern: index, loop: true }, sampleRate);
          const ticks = wasm.patternTicks(bank[index]!);
          expect(render.left.length).toBe(wasm.tickFrame(ticks * 2, tempo, sampleRate) - wasm.tickFrame(ticks, tempo, sampleRate));
          expect(render.events).toHaveLength(hits(bank[index]!));
          expect(new Set(render.events.map((event) => event.pattern))).toEqual(new Set([index]));
        }
      }
    }
  });

  it('is deterministic, and audible on both sides', () => {
    const a = renderSong(wasm, setup, { pattern: 0, loop: true }, RATE);
    const b = renderSong(wasm, setup, { pattern: 0, loop: true }, RATE);
    expect(Buffer.from(a.left.buffer).equals(Buffer.from(b.left.buffer))).toBe(true);
    expect(rms(a.left)).toBeGreaterThan(0.01);
    expect(rms(a.right)).toBeGreaterThan(0.01);
    expect(a.events[0]!.frame).toBe(0);
    expect(a.events.filter((event) => event.accent).every((event) => event.step === 0)).toBe(true);
  });

  it('plays the 2nd part after the 1st, from its own steps', () => {
    const render = renderSong(wasm, setup, { pattern: 4, loop: true }, RATE);
    const played = [...new Set(render.events.map((event) => event.step))];
    expect(Math.max(...played)).toBeGreaterThanOrEqual(16);
    // Thirty-two steps at eight to the beat are still four beats.
    expect(render.left.length).toBe(MEASURE);
  });

  it('renders A then B as one loop of two measures', () => {
    const both = renderSong(wasm, setup, song([0, 0], true, { variation: 'ab' }), RATE);
    expect(both.left.length).toBe(2 * MEASURE);
    expect(both.events.map((event) => event.pattern)).toEqual([
      ...new Array<number>(hits(A0)).fill(0),
      ...new Array<number>(hits(B0)).fill(1),
    ]);
  });

  it('renders a song once through, measure after measure, and lets it ring', () => {
    const plan = song([0, 1, 2, 12, 0], false);
    const render = renderSong(wasm, setup, plan, RATE);
    expect(wasm.songPatterns(plan.panel, plan.rhythms)).toEqual([0, 2, 4, 24, 0]);
    expect(render.left.length).toBe(5 * MEASURE + 3 * RATE);
    expect([...new Set(render.events.map((event) => event.pattern))]).toEqual([0, 2, 4, 24]);
    expect(Math.max(...render.events.map((event) => event.frame))).toBeLessThan(5 * MEASURE);
    // Silence by the end of the tail.
    expect(rms(render.left.subarray(render.left.length - 4410))).toBeLessThan(1e-4);
  });

  it('plays a loop often enough for an effect to settle, without changing its length', () => {
    const plain = renderSong(wasm, setup, { pattern: 0, loop: true }, RATE);
    const echoed = renderSong(wasm, { ...setup, effect: { kind: 'delay', wet: 0.8 } }, { pattern: 0, loop: true }, RATE);
    expect(echoed.left.length).toBe(plain.left.length);
    expect(echoed.events.map((event) => [event.step, event.track])).toEqual(plain.events.map((event) => [event.step, event.track]));
    expect(echoed.left).not.toEqual(plain.left);
    // Twice with nothing ringing on, and a pass more for every loop length the tail lasts.
    expect(loopPasses(0, 2)).toBe(2);
    expect(loopPasses(1.9, 2)).toBe(2);
    expect(loopPasses(2.1, 2)).toBe(3);
    expect(loopPasses(5.4, 2)).toBe(4);
    expect(loopPasses(60, 0.5)).toBe(8);
  });
});

describe('what the engine plays measure by measure', () => {
  function measuresOf(start: (engine: ReturnType<typeof wasm.createEngine>) => void) {
    const engine = wasm.createEngine(RATE, 1024);
    try {
      applySetup(engine, setup);
      start(engine);
      const left = new Float32Array(1024);
      const right = new Float32Array(1024);
      const measures = [];
      do {
        engine.render(left, right);
        measures.push(...(engine.takeMeasures() ?? []));
      } while (engine.playing);
      return { measures, stopFrame: engine.stopFrame };
    } finally {
      engine.destroy();
    }
  }

  it('follows the panel: A and B in turn, an intro when armed, a fill-in when one is due', () => {
    const { measures } = measuresOf((engine) => {
      engine.setPanel(panel({ variation: 'ab', autoFill: 4, firstBeatRule: true }));
      engine.armFill(true);
      engine.playMeasures(6);
    });
    expect(measures.map((measure) => [measure.ordinal, measure.pattern, measure.kind])).toEqual([
      [1, 24, 'intro'],
      [2, 0, 'basic'],
      [3, 1, 'basic'],
      [4, 0, 'basic'],
      [5, 24, 'fill'],
      [6, 1, 'basic'],
    ]);
    expect(measures[0]!.frame).toBe(0);
    expect(measures[1]!.frame).toBe(MEASURE);
  });

  it('follows a song, and says which of its measures each one is', () => {
    const rhythms = [0, 0, 1, 2, 12, 0];
    const { measures, stopFrame } = measuresOf((engine) => {
      engine.setPanel(panel());
      engine.setSong(rhythms, false);
      engine.play();
    });
    expect(measures.map((measure) => measure.pattern >> 1)).toEqual(rhythms);
    expect(measures.map((measure) => measure.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(stopFrame).toBe(rhythms.length * MEASURE);
  });

  it('says which version each measure of a song plays, as the switches stand', () => {
    const rhythms = [0, 0, 1, 12, 0];
    expect(wasm.songPatterns(panel({ variation: 'ab' }), rhythms)).toEqual([0, 1, 2, 24, 1]);
    expect(wasm.songPatterns(panel({ variation: 'b', fillVariation: 'b' }), rhythms)).toEqual([1, 1, 3, 25, 1]);
    expect(wasm.songPatterns(panel(), [])).toEqual([]);
    expect(() => wasm.songPatterns(panel(), [16])).toThrow(/rejected a song/);
  });

  it('refuses a song longer than it can hold', () => {
    const engine = wasm.createEngine(RATE, 1024);
    try {
      expect(() => engine.setSong(new Array<number>(769).fill(0), false)).toThrow(/768/);
    } finally {
      engine.destroy();
    }
  });
});

describe('WAV export', () => {
  const render = renderSong(wasm, setup, { pattern: 0, loop: true }, RATE);

  it('writes stereo PCM that reads back as it was written', () => {
    for (const bits of [16, 24] as const) {
      const bytes = encodeWav(render.left, render.right, RATE, bits);
      const decoded = decodeWav(bytes.buffer as ArrayBuffer);
      expect(decoded.channels).toBe(2);
      expect(decoded.sampleRate).toBe(RATE);
      expect(decoded.frames).toBe(render.left.length);
      expect(bytes.length).toBe(44 + decoded.frames * 2 * (bits / 8));
      expect(rms(decoded.pcm)).toBeGreaterThan(0.01);
      const tolerance = bits === 16 ? 1 / 32767 : 1 / 8388607;
      expect(Math.abs(decoded.pcm[2000]! - render.left[1000]!)).toBeLessThanOrEqual(tolerance);
    }
  });

  it('refuses a file that is not usable audio', () => {
    expect(() => decodeWav(new ArrayBuffer(10))).toThrow(/too short/);
    expect(() => decodeWav(new Uint8Array(64).buffer)).toThrow(/RIFF/);
    const good = encodeWav(new Float32Array(100), new Float32Array(100), RATE, 16);
    new DataView(good.buffer).setUint16(22, 6, true); // six channels
    expect(() => decodeWav(good.buffer as ArrayBuffer)).toThrow(/mono and stereo/);
  });
});

describe('MIDI export', () => {
  it('writes a Type 1 file with a tempo track and drum notes on channel 10', () => {
    const plan = forMidi(song([0], true));
    const midi = parseMidi(exportSongMidi(wasm, setup, plan));
    expect(midi).toMatchObject({ format: 1, trackCount: 2, ppq: 480, tempoMicros: 500_000 });
    expect(midi.trackEnds).toEqual([1920, 1920]);
    expect(midi.signatures).toEqual([[0, 4, 2]]);
    const ons = midi.notes.filter((note) => note.on);
    expect(midi.notes).toHaveLength(hits(A0) * 2);
    expect(ons).toHaveLength(hits(A0));
    expect(midi.notes.every((note) => note.channel === 10)).toBe(true);
    // Every note is its track's, on its step's tick, and louder on the accented step.
    const kicks = ons.filter((note) => note.note === 36);
    expect(kicks.map((note) => note.tick)).toEqual([0, 480, 960, 1440]);
    expect(kicks.map((note) => note.velocity)).toEqual([127, 76, 76, 76]);
    expect(ons.filter((note) => note.note === 38).map((note) => note.tick)).toEqual([480, 1440]);
  });

  it('writes measures of different shapes one after another', () => {
    // Sixteenths, triplets and thirty-seconds: each measure is four beats.
    const plan = forMidi(song([0, 1, 2, 0], false));
    const midi = parseMidi(exportSongMidi(wasm, setup, plan));
    expect(midi.trackEnds).toEqual([1920 * 4, 1920 * 4]);
    expect(midi.notes.filter((note) => note.on)).toHaveLength(hits(A0) + hits(TRIPLETS) + hits(TWO_PARTS) + hits(A0));
  });

  it('places notes on the same timeline as the audio', () => {
    for (const index of [0, 2, 4]) {
      const midi = parseMidi(exportSongMidi(wasm, setup, forMidi(song([index >> 1], true))));
      const render = renderSong(wasm, setup, { pattern: index, loop: true }, 48000);
      const framesPerTick = (48000 * 60) / TEMPO / 480;
      const ticks = [...new Set(midi.notes.filter((note) => note.on).map((note) => note.tick))];
      const frames = [...new Set(render.events.map((event) => event.frame))];
      expect(ticks).toHaveLength(frames.length);
      // Within one frame of the audio: MIDI ticks are whole engine ticks.
      ticks.forEach((tick, i) => expect(Math.abs(tick * framesPerTick - frames[i]!)).toBeLessThanOrEqual(1));
    }
  });
});

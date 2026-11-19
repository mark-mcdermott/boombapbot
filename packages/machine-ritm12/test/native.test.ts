import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySetup, decodeWav, encodeWav, exportSongMidi, type EngineSetup } from '@boombapbot/editor/engine';
import { loadWasm, renderToolPath } from '../../editor/test/helpers';
import { engineSetup, exportPlan } from '../src/engine';
import { loadFixture } from './helpers';

// РИТМ-12 through the engine built natively and the one built to
// WebAssembly. Both are given the same setup and asked for the same
// measures; what comes out must agree.

const wasm = loadWasm('ritm12');
const nativeRenderPath = renderToolPath('ritm12');
const built = existsSync(nativeRenderPath);
if (!built) console.warn(`skipped: ${nativeRenderPath} is missing. Run "pnpm build:engine" first.`);

const RATE = 44100;
const BLOCK = 1024;
const MEASURES = 2;
/** The most the two builds may differ by, in steps of 24-bit audio. */
const DRY_STEPS = 2;
/** An effect feeds its own output back, so last-bit differences can add up a little before they die away. */
const EFFECT_STEPS = 4;

const fixture = loadFixture();
/** The fixture with its effect off, so each test adds the one it is about. */
const dry: EngineSetup = { ...engineSetup(fixture), effect: undefined };

interface Played {
  left: Float32Array;
  right: Float32Array;
  events: Array<{ frame: number; step: number; track: number; accent: boolean; pattern: number }>;
}

/** Measures of a pattern, from silence, through the WebAssembly engine. */
function throughWasm(setup: EngineSetup, pattern: number): Played {
  const engine = wasm.createEngine(RATE, BLOCK);
  try {
    engine.enableEventLog(8192);
    applySetup(engine, setup);
    const frames = wasm.tickFrame(MEASURES * wasm.patternTicks(setup.patterns[pattern]!), setup.tempo, RATE);
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    engine.cuePattern(pattern);
    engine.playMeasures(MEASURES);
    for (let done = 0; done < frames; done += BLOCK) {
      const count = Math.min(BLOCK, frames - done);
      engine.render(left.subarray(done, done + count), right.subarray(done, done + count), count);
    }
    return { left, right, events: engine.readEvents() };
  } finally {
    engine.destroy();
  }
}

/** The same measures through the native engine, by its render tool. */
function throughNative(setup: EngineSetup, pattern: number, midi?: { notes: number[]; plain: number; accented: number }) {
  const dir = mkdtempSync(join(tmpdir(), 'boombapbot-ritm12-'));
  const run = join(dir, 'run.json');
  const wav = join(dir, 'measures.wav');
  const events = join(dir, 'events.json');
  const midiFile = join(dir, 'beat.mid');
  writeFileSync(run, JSON.stringify({ rate: RATE, setup, pattern, measures: midi ? 1 : MEASURES, midi }));
  execFileSync(nativeRenderPath, ['--setup', run, '--out', wav, '--events', events, ...(midi ? ['--midi', midiFile] : [])]);
  return {
    audio: decodeWav(new Uint8Array(readFileSync(wav)).buffer as ArrayBuffer),
    events: (JSON.parse(readFileSync(events, 'utf8')) as Array<Omit<Played['events'][number], 'accent'> & { accent: number }>).map(
      (event) => ({ ...event, accent: event.accent !== 0 }),
    ),
    midi: midi ? readFileSync(midiFile) : null,
  };
}

/** The most two renders differ by, in steps of 24-bit audio. */
function worstSteps(native: Float32Array, played: Played): number {
  const encoded = decodeWav(encodeWav(played.left, played.right, RATE, 24).buffer as ArrayBuffer);
  expect(native.length).toBe(encoded.pcm.length);
  let worst = 0;
  for (let i = 0; i < native.length; i += 1) worst = Math.max(worst, Math.abs(native[i]! - encoded.pcm[i]!));
  return worst * 8388608;
}

describe.skipIf(!built)('РИТМ-12, native against WebAssembly', () => {
  it('plays every pattern of the fixture on the same frames and to the same samples', () => {
    for (const pattern of [0, 1, 2, 3]) {
      const played = throughWasm(dry, pattern);
      const native = throughNative(dry, pattern);
      expect(played.events.length, `pattern ${pattern}`).toBeGreaterThan(0);
      expect(native.events, `pattern ${pattern}`).toEqual(played.events);
      expect(worstSteps(native.audio.pcm, played), `pattern ${pattern}`).toBeLessThanOrEqual(DRY_STEPS);
    }
  });

  it('agrees straight, swung as far as it goes, and in triplets', () => {
    const straight = throughWasm(engineSetup({ ...fixture, swing: 0, effect: { kind: 'delay', mix: 0 } }), 0);
    for (const change of [{ swing: 0 }, { swing: 1 }, { size: 12 as const }]) {
      const setup = engineSetup({ ...fixture, ...change, effect: { kind: 'delay', mix: 0 } });
      const played = throughWasm(setup, 0);
      const native = throughNative(setup, 0);
      const what = JSON.stringify(change);
      expect(native.events, what).toEqual(played.events);
      expect(worstSteps(native.audio.pcm, played), what).toBeLessThanOrEqual(DRY_STEPS);
      if (change.swing === 1) {
        expect(played.events.map((event) => event.frame)).not.toEqual(straight.events.map((event) => event.frame));
      }
    }
  });

  it('renders each effect the same, to within a few steps of 24-bit audio', () => {
    const plain = throughWasm(dry, 0);
    // The four the machine has, and the six the engine has beside them.
    const kinds = ['delay', 'reverb', 'flanger', 'chorus', 'crusher', 'tape', 'pump', 'filter', 'vinyl', 'phaser'] as const;
    for (const kind of kinds) {
      const setup: EngineSetup = { ...dry, effect: { kind, wet: 1 } };
      const played = throughWasm(setup, 0);
      const native = throughNative(setup, 0);
      expect(played.left, kind).not.toEqual(plain.left);
      expect(native.events, kind).toEqual(played.events);
      expect(worstSteps(native.audio.pcm, played), kind).toBeLessThanOrEqual(EFFECT_STEPS);
    }
  });

  it('writes the same MIDI file, byte for byte', () => {
    for (const pattern of [0, 2]) {
      const project = { ...fixture, panel: { ...fixture.panel, pattern } };
      const plan = exportPlan(project);
      const native = throughNative(engineSetup(project), pattern, { notes: plan.notes, ...plan.velocities });
      const exported = exportSongMidi(wasm, engineSetup(project), plan);
      expect(Buffer.from(exported).equals(native.midi!), `pattern ${pattern}`).toBe(true);
    }
  });
});

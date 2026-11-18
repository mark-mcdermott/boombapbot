import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SynthSound } from '../../editor/src/engine';
import { loadWasm, renderToolPath, rms } from '../../editor/test/helpers';

const wasm = loadWasm('ritm12');
const nativeRenderPath = renderToolPath('ritm12');
const VOICES = 8;
/** One step of 24-bit audio: the most a sound may differ between builds. */
const STEP_24_BIT = 1 / 8388608;

/** A voice with its pitch, tone and decay knobs all at one position. */
function settings(sound: number, knob = 0.5): SynthSound {
  return { sound, tune: knob, tone: knob, decay: knob, snappy: 0.5 };
}

describe('the voices of the РИТМ-12', () => {
  it('has eight, each audible, bounded and ending in silence', () => {
    for (let sound = 0; sound < VOICES; sound += 1) {
      const pcm = wasm.synthesise(settings(sound), 48000);
      expect(pcm.every(Number.isFinite)).toBe(true);
      const peak = pcm.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
      expect(peak).toBeGreaterThan(0.2);
      expect(peak).toBeLessThanOrEqual(1);
      expect(rms(pcm)).toBeGreaterThan(0);
      expect(Math.abs(pcm[pcm.length - 1]!)).toBe(0);
    }
    expect(() => wasm.synthesise(settings(VOICES), 48000)).toThrow(/could not be synthesised/);
  });

  it('is deterministic, and a longer decay is a longer sound', () => {
    for (let sound = 0; sound < VOICES; sound += 1) {
      const first = wasm.synthesise(settings(sound), 44100);
      expect(wasm.synthesise(settings(sound), 44100)).toEqual(first);
      expect(wasm.synthesise(settings(sound, 1), 44100).length).toBeGreaterThan(first.length);
    }
  });

  it('matches the native build, voice by voice', () => {
    if (!existsSync(nativeRenderPath)) {
      console.warn(`skipped: ${nativeRenderPath} is missing. Run "pnpm build:engine" first.`);
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'boombapbot-ritm12-'));
    for (const rate of [44100, 48000]) {
      for (let sound = 0; sound < VOICES; sound += 1) {
        for (const knob of [0.2, 0.8]) {
          const file = join(dir, `${sound}-${rate}-${knob}.f32`);
          execFileSync(nativeRenderPath, [
            '--synth', String(sound), '--raw', file, '--rate', String(rate),
            '--tune', String(knob), '--tone', String(knob), '--decay', String(knob), '--snappy', '0.5',
          ]);
          const bytes = readFileSync(file);
          const native = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
          const built = wasm.synthesise(settings(sound, knob), rate);
          expect(built.length, `voice ${sound} length`).toBe(native.length);
          let worst = 0;
          for (let i = 0; i < native.length; i += 1) worst = Math.max(worst, Math.abs(native[i]! - built[i]!));
          expect(worst, `voice ${sound} at ${rate} Hz, knobs ${knob}`).toBeLessThanOrEqual(STEP_24_BIT);
        }
      }
    }
  });
});

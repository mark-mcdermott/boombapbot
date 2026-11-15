import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KITS, ROLES, defaultSoundSettings } from '@boombapbot/contracts';
import { synthesiseKit, type SynthSound } from '../src/engine';
import { loadWasm, nativeRenderPath, rms } from './helpers';

const wasm = loadWasm();
const SOUNDS = 16;
/** One step of 24-bit audio: the most a sound may differ between builds. */
const STEP_24_BIT = 1 / 8388608;

function settings(sound: number, knob = 0.5): SynthSound {
  return { sound, tune: knob, tone: knob, decay: knob, snappy: knob };
}

describe('synthesised sounds', () => {
  it('renders every sound, audible, bounded and ending in silence', () => {
    for (let sound = 0; sound < SOUNDS; sound += 1) {
      const pcm = wasm.synthesise(settings(sound), 48000);
      expect(pcm.length).toBeGreaterThan(48000 * 0.05);
      expect(pcm.every(Number.isFinite)).toBe(true);
      const peak = pcm.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
      expect(peak).toBeGreaterThan(0.2);
      expect(peak).toBeLessThanOrEqual(1);
      expect(Math.abs(pcm[pcm.length - 1]!)).toBe(0);
    }
  });

  it('is deterministic and follows its knobs', () => {
    const first = wasm.synthesise(settings(0), 44100);
    expect(wasm.synthesise(settings(0), 44100)).toEqual(first);
    expect(wasm.synthesise(settings(0, 1), 44100).length).toBeGreaterThan(first.length);
    expect(() => wasm.synthesise(settings(SOUNDS), 44100)).toThrow(/could not be synthesised/);
  });

  it('matches the native build, sound by sound', () => {
    if (!existsSync(nativeRenderPath)) {
      console.warn(`skipped: ${nativeRenderPath} is missing. Run "pnpm build:engine" first.`);
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'boombapbot-synth-'));
    for (const rate of [44100, 48000]) {
      for (let sound = 0; sound < SOUNDS; sound += 1) {
        for (const knob of [0.2, 0.8]) {
          const file = join(dir, `${sound}-${rate}-${knob}.f32`);
          execFileSync(nativeRenderPath, [
            '--synth', String(sound), '--raw', file, '--rate', String(rate),
            '--tune', String(knob), '--tone', String(knob), '--decay', String(knob), '--snappy', String(knob),
          ]);
          const bytes = readFileSync(file);
          const native = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
          const built = wasm.synthesise(settings(sound, knob), rate);
          expect(built.length, `sound ${sound} length`).toBe(native.length);
          let worst = 0;
          for (let i = 0; i < native.length; i += 1) worst = Math.max(worst, Math.abs(native[i]! - built[i]!));
          expect(worst, `sound ${sound} at ${rate} Hz, knobs ${knob}`).toBeLessThanOrEqual(STEP_24_BIT);
        }
      }
    }
  });

  it('builds the 808 kit from them, one sound per role, at the requested rate', () => {
    for (const rate of [44100, 48000]) {
      const kit = synthesiseKit(wasm, KITS['808'], rate, defaultSoundSettings());
      expect(kit.voices.map((voice) => voice.role)).toEqual(ROLES.map((role) => role.index));
      for (const voice of kit.voices) {
        expect(voice.sampleRate).toBe(rate);
        expect(voice.channels).toBe(1);
        expect(voice.frames).toBe(voice.pcm.length);
        expect(rms(voice.pcm)).toBeGreaterThan(0.01);
      }
    }
    // A knob changes its own voice and no other.
    const sound = defaultSoundSettings();
    sound.kick.decay = 1;
    const plain = synthesiseKit(wasm, KITS['808'], 44100, defaultSoundSettings());
    const longKick = synthesiseKit(wasm, KITS['808'], 44100, sound);
    expect(longKick.voices[0]!.frames).toBeGreaterThan(plain.voices[0]!.frames);
    expect(longKick.voices[1]!.pcm).toEqual(plain.voices[1]!.pcm);
    expect(KITS['808'].synthesised).toBe(true);
    expect(KITS['909'].synthesised).toBeUndefined();
  });
});

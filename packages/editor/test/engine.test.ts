import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KIT_IDS, ROLES, countHits, getRole } from '@boombapbot/contracts';
import { decodeWav, encodeWav, exportMidi, renderLoop, type LoopRender } from '../src/engine';
import {
  fixturePath,
  loadDecodedKit,
  loadFixture,
  loadWasm,
  nativeRenderPath,
  parseMidi,
  repoRoot,
  rms,
} from './helpers';

const wasm = loadWasm();
const fixture = loadFixture();

describe('WebAssembly engine', () => {
  it('renders the fixture through every kit with the same timing', async () => {
    const renders: LoopRender[] = [];
    for (const id of KIT_IDS) {
      renders.push(renderLoop(wasm, fixture, await loadDecodedKit(id), 44100));
    }
    const reference = renders[0]!;
    expect(reference.events).toHaveLength(countHits(fixture.pattern));
    for (const render of renders) {
      expect(render.events).toEqual(reference.events);
      expect(render.left).toHaveLength(reference.left.length);
      expect(rms(render.left)).toBeGreaterThan(0.01);
      expect(rms(render.right)).toBeGreaterThan(0.01);
    }
    // Kits must sound different from one another.
    for (let a = 0; a < renders.length; a += 1) {
      for (let b = a + 1; b < renders.length; b += 1) {
        const difference = renders[a]!.left.map((sample, i) => sample - renders[b]!.left[i]!);
        expect(rms(difference)).toBeGreaterThan(0.01);
      }
    }
  });

  it('keeps event roles and velocities from the project', async () => {
    const render = renderLoop(wasm, fixture, await loadDecodedKit('808'), 48000);
    for (const event of render.events) {
      const role = ROLES[event.role]!;
      const lane = fixture.pattern.lanes.find((candidate) => candidate.role === role.id)!;
      expect(lane.steps[event.step]).toBe(event.velocity);
    }
    const first = render.events[0]!;
    expect(first.frame).toBe(0);
    expect(first.role).toBe(getRole('kick').index);
  });

  it('renders a loop of exactly one bar at any tempo, swing or rate', async () => {
    const kit = await loadDecodedKit('606');
    for (const sampleRate of [44100, 48000]) {
      for (const bpm of [60, 97, 124, 133, 174]) {
        for (const swing of [50, 62, 75]) {
          const render = renderLoop(wasm, { ...fixture, bpm, swing }, kit, sampleRate);
          expect(render.left.length).toBe(Math.floor((sampleRate * 240) / bpm + 0.5));
          expect(render.events).toHaveLength(countHits(fixture.pattern));
        }
      }
    }
  });

  it('is deterministic', async () => {
    const kit = await loadDecodedKit('909');
    const a = renderLoop(wasm, fixture, kit, 44100);
    const b = renderLoop(wasm, fixture, kit, 44100);
    expect(Buffer.from(a.left.buffer).equals(Buffer.from(b.left.buffer))).toBe(true);
  });

  it('matches the native build', async () => {
    // Skipped only when the native tool has not been built (pnpm build:engine).
    if (!existsSync(nativeRenderPath)) {
      console.warn('native boombapbot-render not built; skipping native/WASM comparison');
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'boombapbot-'));
    for (const id of KIT_IDS) {
      const wavPath = join(dir, `${id}.wav`);
      const eventsPath = join(dir, `${id}.json`);
      execFileSync(nativeRenderPath, [
        '--project', fixturePath,
        '--contracts', resolve(repoRoot, 'packages/contracts'),
        '--assets', resolve(repoRoot, 'assets'),
        '--kit', id,
        '--out', wavPath,
        '--events', eventsPath,
      ]);
      const native = decodeWav(new Uint8Array(readFileSync(wavPath)).buffer as ArrayBuffer);
      const nativeEvents = JSON.parse(readFileSync(eventsPath, 'utf8')) as Array<{
        frame: number;
        step: number;
        role: number;
        velocity: number;
      }>;
      const render = renderLoop(wasm, fixture, await loadDecodedKit(id), 44100);

      // Event timing is identical. The native log covers both rendered bars.
      const loopFrames = render.left.length;
      const secondBar = nativeEvents
        .filter((event) => event.frame >= loopFrames)
        .map((event) => ({ ...event, frame: event.frame - loopFrames }));
      expect(secondBar).toEqual(render.events);

      // Audio agrees to within two 24-bit steps. The only source of difference
      // is the last bit of libm results (pow, tanh, sin, cos) between glibc
      // and the WebAssembly libc.
      expect(native.frames).toBe(loopFrames);
      const encoded = decodeWav(
        encodeWav(render.left, render.right, 44100, 24).buffer as ArrayBuffer,
      );
      let worst = 0;
      for (let i = 0; i < native.pcm.length; i += 1) {
        worst = Math.max(worst, Math.abs(native.pcm[i]! - encoded.pcm[i]!));
      }
      expect(worst).toBeLessThanOrEqual(2 / 8388608);
    }
  });
});

describe('WAV export', () => {
  it('writes one bar of stereo PCM with nonzero audio', async () => {
    const render = renderLoop(wasm, fixture, await loadDecodedKit('707'), 44100);
    for (const bits of [16, 24] as const) {
      const bytes = encodeWav(render.left, render.right, 44100, bits);
      const decoded = decodeWav(bytes.buffer as ArrayBuffer);
      expect(decoded.channels).toBe(2);
      expect(decoded.sampleRate).toBe(44100);
      expect(decoded.frames).toBe(render.left.length);
      // 124 bpm: one bar of 4/4 lasts 240 / 124 seconds.
      expect(decoded.frames / decoded.sampleRate).toBeCloseTo(240 / 124, 4);
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
    const midi = parseMidi(exportMidi(wasm, fixture));
    expect(midi.format).toBe(1);
    expect(midi.trackCount).toBe(2);
    expect(midi.ppq).toBe(480);
    expect(midi.tempoMicros).toBe(Math.floor(60_000_000 / fixture.bpm + 0.5));
    expect(midi.trackEnds).toEqual([1920, 1920]);

    const hits = countHits(fixture.pattern);
    expect(midi.notes).toHaveLength(hits * 2);
    const noteOns = midi.notes.filter((note) => note.on);
    expect(noteOns).toHaveLength(hits);
    expect(midi.notes.every((note) => note.channel === 10)).toBe(true);

    // Every note-on sits on its step's tick with the project's velocity.
    const expected = fixture.pattern.lanes
      .flatMap((lane) =>
        lane.steps.flatMap((velocity, step) =>
          velocity > 0
            ? [{ tick: wasm.midiStepTick(step, fixture.swing), note: getRole(lane.role).gmNote, velocity }]
            : [],
        ),
      )
      .sort((a, b) => a.tick - b.tick || a.note - b.note);
    const actual = noteOns
      .map(({ tick, note, velocity }) => ({ tick, note, velocity }))
      .sort((a, b) => a.tick - b.tick || a.note - b.note);
    expect(actual).toEqual(expected);
  });

  it('places swung notes on the same timeline as audio', async () => {
    const swung = { ...fixture, swing: 66 };
    const midi = parseMidi(exportMidi(wasm, swung));
    const render = renderLoop(wasm, swung, await loadDecodedKit('808'), 48000);
    const framesPerTick = (48000 * 60) / swung.bpm / 480;
    const ticks = [...new Set(midi.notes.filter((note) => note.on).map((note) => note.tick))];
    const frames = [...new Set(render.events.map((event) => event.frame))];
    expect(ticks).toHaveLength(frames.length);
    ticks.forEach((tick, i) => {
      // Within one MIDI tick of the audio event.
      expect(Math.abs(tick * framesPerTick - frames[i]!)).toBeLessThanOrEqual(framesPerTick);
    });
  });
});

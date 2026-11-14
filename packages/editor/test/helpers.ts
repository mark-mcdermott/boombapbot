import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KITS, parseProject, type KitId, type Project } from '@boombapbot/contracts';
import { loadKit, SnareWasm, type DecodedKit } from '../src/engine';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const wasmPath = resolve(repoRoot, 'build/wasm/boombapbot-engine.wasm');
export const nativeRenderPath = resolve(repoRoot, 'build/native/boombapbot-render');
export const fixturePath = resolve(
  repoRoot,
  'packages/contracts/fixtures/kick-snare-hat.project.json',
);

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function loadWasm(): SnareWasm {
  if (!existsSync(wasmPath)) {
    throw new Error(`${wasmPath} is missing. Run "pnpm build:wasm" first.`);
  }
  return SnareWasm.fromBytes(readFileSync(wasmPath));
}

export function loadDecodedKit(id: KitId): Promise<DecodedKit> {
  return loadKit(KITS[id], resolve(repoRoot, 'assets'), async (path) =>
    toArrayBuffer(readFileSync(path)),
  );
}

export function loadFixture(): Project {
  const result = parseProject(JSON.parse(readFileSync(fixturePath, 'utf8')));
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.project;
}

export function rms(signal: Float32Array): number {
  let sum = 0;
  for (const sample of signal) sum += sample * sample;
  return Math.sqrt(sum / signal.length);
}

export interface ParsedMidi {
  format: number;
  trackCount: number;
  ppq: number;
  tempoMicros: number;
  trackEnds: number[];
  notes: Array<{ tick: number; on: boolean; channel: number; note: number; velocity: number }>;
}

/** Minimal Standard MIDI File reader for assertions. */
export function parseMidi(bytes: Uint8Array): ParsedMidi {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (text(0) !== 'MThd') throw new Error('not a MIDI file');
  const parsed: ParsedMidi = {
    format: view.getUint16(8),
    trackCount: view.getUint16(10),
    ppq: view.getUint16(12),
    tempoMicros: 0,
    trackEnds: [],
    notes: [],
  };
  let position = 14;
  while (position < bytes.length) {
    if (text(position) !== 'MTrk') throw new Error('bad track header');
    const end = position + 8 + view.getUint32(position + 4);
    let p = position + 8;
    let tick = 0;
    while (p < end) {
      let delta = 0;
      let byte: number;
      do {
        byte = bytes[p++]!;
        delta = (delta << 7) | (byte & 0x7f);
      } while (byte & 0x80);
      tick += delta;
      const status = bytes[p++]!;
      if (status === 0xff) {
        const type = bytes[p++]!;
        const size = bytes[p++]!;
        if (type === 0x51) {
          parsed.tempoMicros = (bytes[p]! << 16) | (bytes[p + 1]! << 8) | bytes[p + 2]!;
        }
        if (type === 0x2f) parsed.trackEnds.push(tick);
        p += size;
      } else {
        parsed.notes.push({
          tick,
          on: (status & 0xf0) === 0x90,
          channel: (status & 0x0f) + 1,
          note: bytes[p]!,
          velocity: bytes[p + 1]!,
        });
        p += 2;
      }
    }
    position = end;
  }
  return parsed;
}

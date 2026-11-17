import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SnareWasm } from '../src/engine';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const wasmPath = resolve(repoRoot, 'build/wasm/boombapbot-engine.wasm');
export const nativeRenderPath = resolve(repoRoot, 'build/native/boombapbot-render');

export function loadWasm(): SnareWasm {
  if (!existsSync(wasmPath)) {
    throw new Error(`${wasmPath} is missing. Run "pnpm build:wasm" first.`);
  }
  return SnareWasm.fromBytes(readFileSync(wasmPath));
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
  /** Time signatures as [tick, numerator, power of two of the denominator]. */
  signatures: Array<[number, number, number]>;
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
    signatures: [],
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
        if (type === 0x58) parsed.signatures.push([tick, bytes[p]!, bytes[p + 1]!]);
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

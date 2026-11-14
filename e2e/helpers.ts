import { readFileSync } from 'node:fs';
import { expect, type Download, type Page } from '@playwright/test';

export interface ProjectSnapshot {
  name: string;
  bpm: number;
  swing: number;
  kit: { id: string; version: string };
  pattern: { lanes: Array<{ id: string; role: string; steps: number[] }> };
}

export interface DebugSnapshot {
  audioStatus: string;
  sampleRate: number | null;
  stats: { frames: number; peak: number; peakEver: number; voices: number; stolen: number } | null;
  engineKit: string | null;
  project: ProjectSnapshot;
}

export async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
}

export function debug(page: Page): Promise<DebugSnapshot> {
  return page.evaluate(() => window.__boombapbot!.debug() as unknown as DebugSnapshot);
}

export async function project(page: Page): Promise<ProjectSnapshot> {
  return (await debug(page)).project;
}

export function lane(snapshot: ProjectSnapshot, role: string): number[] {
  const found = snapshot.pattern.lanes.find((candidate) => candidate.role === role);
  if (!found) throw new Error(`no lane for ${role}`);
  return found.steps;
}

export function hitCount(snapshot: ProjectSnapshot): number {
  return snapshot.pattern.lanes.reduce(
    (total, candidate) => total + candidate.steps.filter((velocity) => velocity > 0).length,
    0,
  );
}

export function step(page: Page, role: string, index: number) {
  return page.locator(`.sb-step[data-role="${role}"][data-step="${index}"]`);
}

export async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error('download has no file');
  return readFileSync(path);
}

/** Opens the Export menu and picks an item, returning the download. */
export async function exportVia(page: Page, itemTestId: string): Promise<Download> {
  await page.getByTestId('export-menu').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(itemTestId).click(),
  ]);
  return download;
}

export interface ParsedWav {
  channels: number;
  sampleRate: number;
  bits: number;
  frames: number;
  peak: number;
  rms: number;
}

export function parseWav(bytes: Buffer): ParsedWav {
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file');
  }
  const channels = bytes.readUInt16LE(22);
  const sampleRate = bytes.readUInt32LE(24);
  const bits = bytes.readUInt16LE(34);
  if (bytes.toString('latin1', 36, 40) !== 'data') throw new Error('unexpected WAV layout');
  const dataSize = bytes.readUInt32LE(40);
  const bytesPerSample = bits / 8;
  const frames = dataSize / (bytesPerSample * channels);
  let peak = 0;
  let sum = 0;
  const count = frames * channels;
  for (let i = 0; i < count; i += 1) {
    const offset = 44 + i * bytesPerSample;
    const value =
      bits === 16 ? bytes.readInt16LE(offset) / 32768 : bytes.readIntLE(offset, 3) / 8388608;
    peak = Math.max(peak, Math.abs(value));
    sum += value * value;
  }
  return { channels, sampleRate, bits, frames, peak, rms: Math.sqrt(sum / count) };
}

export interface ParsedMidi {
  format: number;
  trackCount: number;
  ppq: number;
  tempoMicros: number;
  trackEnds: number[];
  notes: Array<{ tick: number; on: boolean; channel: number; note: number; velocity: number }>;
}

export function parseMidi(bytes: Buffer): ParsedMidi {
  if (bytes.toString('latin1', 0, 4) !== 'MThd') throw new Error('not a MIDI file');
  const parsed: ParsedMidi = {
    format: bytes.readUInt16BE(8),
    trackCount: bytes.readUInt16BE(10),
    ppq: bytes.readUInt16BE(12),
    tempoMicros: 0,
    trackEnds: [],
    notes: [],
  };
  let position = 14;
  while (position < bytes.length) {
    if (bytes.toString('latin1', position, position + 4) !== 'MTrk') throw new Error('bad track');
    const end = position + 8 + bytes.readUInt32BE(position + 4);
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
        if (type === 0x51) parsed.tempoMicros = bytes.readUIntBE(p, 3);
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

declare global {
  interface Window {
    __boombapbot?: {
      debug(): unknown;
      renderLoop(sampleRate?: number): Promise<{
        frames: number;
        sampleRate: number;
        peak: number;
        rms: number;
        events: Array<{ frame: number; step: number; role: number; velocity: number }>;
      }>;
    };
  }
}

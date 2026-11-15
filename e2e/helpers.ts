import { readFileSync } from 'node:fs';
import { expect, type Download, type Page } from '@playwright/test';

/** The engine's tracks, in panel order. The accent is track 0. */
export const TRACK_IDS = [
  'accent',
  'kick',
  'snare',
  'low_tom',
  'mid_tom',
  'high_tom',
  'rim_shot',
  'clap',
  'cowbell',
  'cymbal',
  'open_hat',
  'closed_hat',
] as const;
export type TrackId = (typeof TRACK_IDS)[number];

export const DRAFT_KEY = 'boombapbot.draft.v2';
export const LEGACY_DRAFT_KEY = 'boombapbot.draft.v1';
export const LEGACY_FIXTURE = 'packages/contracts/fixtures/v1-kick-snare-hat.project.json';

export interface RhythmSnapshot {
  preScale: number;
  firstLength: number;
  secondLength: number;
  a: Record<TrackId, string>;
  b: Record<TrackId, string>;
}

export interface ProjectSnapshot {
  schemaVersion: number;
  name: string;
  updatedAt: string;
  tempo: { coarse: number; fine: number };
  sound: {
    master: number;
    accent: number;
    levels: Record<string, number>;
    knobs: Record<string, Record<'tune' | 'tone' | 'decay' | 'snappy', number>>;
    alternates: Record<string, boolean>;
  };
  rhythms: RhythmSnapshot[];
  rhythmTracks: number[][];
  panel: {
    mode: string;
    selector: number;
    basicRhythm: number;
    fillRhythm: number;
    basicVariation: string;
    fillVariation: string;
    preScale: number;
    writeTarget: string;
  };
}

export interface DebugSnapshot {
  audioStatus: string;
  sampleRate: number | null;
  stats: { frames: number; peak: number; peakEver: number; voices: number; stolen: number } | null;
  soundsSent: number;
  soundsTaken: number;
  project: ProjectSnapshot;
}

export async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
}

/** Opens the settings sheet behind the cog, unless it is open already. */
export async function openSettings(page: Page): Promise<void> {
  const sheet = page.getByTestId('settings-sheet');
  if (await sheet.isVisible()) return;
  await page.getByTestId('settings').click();
  await expect(sheet).toBeVisible();
}

/** Closes the settings sheet and waits until the machine is reachable again. */
export async function closeSettings(page: Page): Promise<void> {
  const sheet = page.getByTestId('settings-sheet');
  if (!(await sheet.isVisible())) return;
  await page.getByTestId('settings-close').click();
  await expect(sheet).toHaveCount(0);
}

/** The faceplate image this build ships, from the asset manifest. */
export async function faceplate(page: Page): Promise<string | null> {
  const response = await page.request.get('/boombapbot-assets.json');
  const manifest = (await response.json()) as { faceplate?: string | null };
  return manifest.faceplate ?? null;
}

/** Whether the faceplate is a credited photograph or our own drawing. */
export function faceplateIsCredited(): boolean {
  const manifest = JSON.parse(readFileSync('packages/contracts/data/panels/808.panel.json', 'utf8')) as {
    faceplate: { credit?: unknown };
  };
  return manifest.faceplate.credit !== undefined;
}

export function debug(page: Page): Promise<DebugSnapshot> {
  return page.evaluate(() => window.__boombapbot!.debug() as unknown as DebugSnapshot);
}

export async function project(page: Page): Promise<ProjectSnapshot> {
  return (await debug(page)).project;
}

/** Steps that are on in one track of version A of a rhythm. */
export function stepsOn(snapshot: ProjectSnapshot, track: TrackId, rhythm = 0): number[] {
  return [...snapshot.rhythms[rhythm]!.a[track]].flatMap((mark, index) => (mark === 'x' ? [index] : []));
}

/** Hits on the instrument tracks of version A of a rhythm. */
export function hitCount(snapshot: ProjectSnapshot, rhythm = 0): number {
  return TRACK_IDS.slice(1).reduce((total, track) => total + stepsOn(snapshot, track, rhythm).length, 0);
}

/** Tempo in beats per minute: 40 click stops across 40 to 300, plus the fine knob. */
export function bpmOf(snapshot: ProjectSnapshot): number {
  const bpm = 40 + ((snapshot.tempo.coarse + snapshot.tempo.fine) * 260) / 39;
  return Math.min(300, Math.max(40, bpm));
}

/** Turns the instrument selector on the faceplate. */
export async function selectTrack(page: Page, track: TrackId): Promise<void> {
  await page.getByTestId(`panel-voice-${track}`).click();
  await expect(page.getByTestId(`panel-voice-${track}`)).toHaveAttribute('aria-checked', 'true');
}

/** One of the sixteen step buttons. */
export function stepButton(page: Page, index: number) {
  return page.getByTestId('panel').locator(`[data-panel-step="${index}"]`);
}

export async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error('download has no file');
  return readFileSync(path);
}

/** Opens the Export menu in settings and picks an item, returning the download. */
export async function exportVia(page: Page, itemTestId: string): Promise<Download> {
  await openSettings(page);
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
        events: Array<{ frame: number; step: number; track: number; accent: boolean; pattern: number }>;
      }>;
    };
  }
}

import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';

export const DRAFT_KEY = 'boombapbot.draft.v3.ritm12';
export const EARLIER_DRAFT_KEY = 'boombapbot.draft.v2';
/** A beat saved by the machine before this one. */
export const EARLIER_BEAT = readFileSync('packages/machine-ritm12/fixtures/earlier-v2.project.json', 'utf8');

export const VOICES = ['kick', 'snare', 'clap', 'closed_hat', 'open_hat', 'tom', 'rim', 'perc'] as const;
export type Voice = (typeof VOICES)[number];

export interface Beat {
  machine: string;
  schemaVersion: number;
  name: string;
  tempo: number;
  swing: number;
  size: number;
  patterns: Array<{ steps: Record<Voice, string>; accents: string }>;
  mix: { volume: number; accent: number; levels: Record<Voice, number>; mutes: Record<Voice, boolean> };
  voices: Record<Voice, { pitch: number; decay: number; tone: number }>;
  effect: { kind: string; mix: number };
  panel: { selected: Voice; pattern: number; write: string };
}

export async function openMachine(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('plate')).toBeVisible();
}

export function beat(page: Page): Promise<Beat> {
  return page.evaluate(() => (window.__boombapbot!.debug() as { project: unknown }).project as Beat);
}

export const step = (page: Page, number: number): Locator => page.getByTestId(`step-${number}`);

/** The steps that are on in a row, counted from 1 as they are lettered. */
export function stepsOn(row: string): number[] {
  return [...row].flatMap((mark, index) => (mark === 'x' ? [index + 1] : []));
}

/** Hits in a pattern, across every voice. */
export function hitCount(pattern: Beat['patterns'][number]): number {
  return VOICES.reduce((sum, voice) => sum + stepsOn(pattern.steps[voice]).length, 0);
}

/** Empties pattern В, selects it and returns to the top of the page: a clean place to write. */
export async function emptyPattern(page: Page): Promise<void> {
  await page.getByTestId('pattern-3').click();
  expect((await beat(page)).panel.pattern).toBe(2);
}

export function playing(page: Page): Promise<{ step: number; pattern: number }> {
  return page.evaluate(() => window.__boombapbot!.playing());
}

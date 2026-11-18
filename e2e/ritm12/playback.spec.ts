import { expect, test } from '@playwright/test';
import { beat, hitCount, openMachine, playing } from './helpers';

test.beforeEach(async ({ page }) => {
  await openMachine(page);
});

test('play starts the engine, the running step moves, and stop stops it', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await expect(editor).toHaveAttribute('data-audio', 'idle');
  await page.getByTestId('play').click();
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await playing(page)).step).toBeGreaterThanOrEqual(0);
  const first = (await playing(page)).step;
  await expect.poll(async () => (await playing(page)).step).not.toBe(first);
  await expect(page.locator('.rt-key[data-now]')).toHaveCount(1);
  await page.getByTestId('stop').click();
  await expect(editor).toHaveAttribute('data-playing', 'false');
  expect(await playing(page)).toEqual({ step: -1, pattern: -1 });
});

test('the space bar starts and stops the machine', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await page.locator('body').press('Space');
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await page.locator('body').press('Space');
  await expect(editor).toHaveAttribute('data-playing', 'false');
});

test('a pattern chosen while another plays takes over at the bar line', async ({ page }) => {
  const tempo = page.getByTestId('tempo');
  await tempo.focus();
  await page.keyboard.press('End');
  await page.getByTestId('play').click();
  await expect.poll(async () => (await playing(page)).pattern).toBe(0);
  await page.getByTestId('pattern-2').click();
  expect((await beat(page)).panel.pattern).toBe(1);
  await expect.poll(async () => (await playing(page)).pattern, { intervals: [20] }).toBe(1);
});

test('the meter needle rises while the machine plays', async ({ page }) => {
  const needle = page.getByTestId('meter-needle');
  const angle = async () => Number(/rotate\((-?[\d.]+)deg\)/.exec((await needle.getAttribute('style')) ?? '')?.[1] ?? 'NaN');
  await expect.poll(angle).toBeLessThan(-40);
  await page.getByTestId('play').click();
  await expect.poll(angle, { timeout: 10_000 }).toBeGreaterThan(-20);
});

test('what an export holds is the pattern on the panel, every hit once', async ({ page }) => {
  const render = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  const now = await beat(page);
  expect(render.events.length).toBe(hitCount(now.patterns[0]!));
  expect(render.frames).toBe(Math.round((44100 * 240) / now.tempo));
  expect(render.rms).toBeGreaterThan(0.02);
  expect(render.peak).toBeLessThanOrEqual(1);
});

test('recording writes tapped instruments into the pattern as one undo step', async ({ page }) => {
  await page.getByTestId('pattern-3').click();
  await page.getByTestId('record').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  await expect.poll(async () => (await playing(page)).step).toBeGreaterThanOrEqual(0);
  await page.getByTestId('voice-clap').click();
  await page.getByTestId('voice-clap').click();
  await page.getByTestId('stop').click();
  const taken = (await beat(page)).patterns[2]!.steps.clap;
  expect(taken).toContain('x');
  await page.keyboard.press('ControlOrMeta+z');
  expect((await beat(page)).patterns[2]!.steps.clap).not.toContain('x');
});

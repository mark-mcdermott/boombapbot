import { expect, test } from '@playwright/test';
import { debug, hitCount, lane, openEditor, project, step } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('kit-606').click();
});

test('hardware and modern editors share one beat', async ({ page }) => {
  const before = await project(page);
  await page.getByTestId('mode-hardware').click();
  const panel = page.getByTestId('panel');
  await expect(panel).toBeVisible();
  // Production builds carry no faceplate photo; the panel is drawn.
  await expect(panel).toHaveAttribute('data-photo', 'drawn');
  expect(await project(page)).toEqual(before);

  // Select the snare on the panel and program two steps.
  await page.getByTestId('panel-voice-snare').click();
  await expect(page.getByTestId('panel-voice')).toContainText('Snare Drum');
  const steps = panel.locator('[data-panel-step]');
  await expect(steps).toHaveCount(16);
  await expect(steps.nth(4)).toHaveAttribute('aria-pressed', 'true');
  await steps.nth(6).click();
  await steps.nth(4).click();
  await expect(steps.nth(6)).toHaveAttribute('aria-pressed', 'true');
  await expect(steps.nth(4)).toHaveAttribute('aria-pressed', 'false');

  // Back in Modern the same edits are there, and nothing else moved.
  await page.getByTestId('mode-modern').click();
  await expect(step(page, 'snare', 6)).toHaveAttribute('aria-pressed', 'true');
  await expect(step(page, 'snare', 4)).toHaveAttribute('aria-pressed', 'false');
  const after = await project(page);
  expect(lane(after, 'kick')).toEqual(lane(before, 'kick'));
  expect(lane(after, 'clap')).toEqual(lane(before, 'clap'));

  // A Modern edit shows up on the panel.
  await step(page, 'snare', 9).click();
  await page.getByTestId('mode-hardware').click();
  await expect(panel.locator('[data-panel-step]').nth(9)).toHaveAttribute('aria-pressed', 'true');
});

test('hits the panel cannot show are kept and pointed out', async ({ page }) => {
  const before = await project(page);
  expect(lane(before, 'clap').some((velocity) => velocity > 0)).toBe(true);
  await page.getByTestId('mode-hardware').click();
  const outside = page.getByTestId('panel-outside');
  await expect(outside).toContainText('Snare Accent (1)');
  await page.getByTestId('panel-voice-kick').click();
  await page.getByTestId('panel').locator('[data-panel-step]').nth(1).click();
  const after = await project(page);
  expect(lane(after, 'clap')).toEqual(lane(before, 'clap'));
  expect(hitCount(after)).toBe(hitCount(before) + 1);
  await outside.getByRole('button', { name: 'Edit them in Modern' }).click();
  await expect(page.getByTestId('grid')).toBeVisible();
});

test('the panel runs the transport and sets tempo', async ({ page }) => {
  await page.getByTestId('mode-hardware').click();
  const editor = page.getByTestId('editor');
  await page.getByTestId('panel-toggle').click();
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
  await page.getByTestId('panel-toggle').click();
  await expect(editor).toHaveAttribute('data-playing', 'false');

  const knob = page.getByTestId('panel-tempo');
  const bpm = (await project(page)).bpm;
  await knob.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('PageUp');
  expect((await project(page)).bpm).toBe(bpm + 11);
  await expect(knob).toHaveAttribute('aria-valuenow', String(bpm + 11));
});

test('panel steps can be walked with the arrow keys', async ({ page }) => {
  await page.getByTestId('mode-hardware').click();
  const steps = page.getByTestId('panel').locator('[data-panel-step]');
  await steps.nth(0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(steps.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(steps.nth(15)).toBeFocused();
});

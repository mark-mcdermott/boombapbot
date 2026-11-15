import { expect, test } from '@playwright/test';
import { chooseKit, closeSettings, debug, openModern, openSettings } from './helpers';

test.beforeEach(async ({ page }) => {
  await openModern(page);
});

test('audio stays off until a user gesture, then the engine renders sound', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await expect(editor).toHaveAttribute('data-audio', 'idle');
  expect((await debug(page)).stats).toBeNull();

  await page.getByTestId('play').click();
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await openSettings(page);
  await expect(page.getByTestId('audio-status')).toHaveText('Audio is running');
  await closeSettings(page);

  // The worklet reports what it rendered: frames advance and the output is
  // not silence.
  await expect.poll(async () => (await debug(page)).stats?.frames ?? 0).toBeGreaterThan(20_000);
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
  const snapshot = await debug(page);
  expect(snapshot.sampleRate).toBeGreaterThanOrEqual(44100);
  expect(snapshot.engineKit).toBe(snapshot.project.kit.id);
  expect(snapshot.stats!.stolen).toBe(0);

  // The playhead follows the engine's steps.
  const seen = new Set<string>();
  const grid = page.getByTestId('grid');
  await expect
    .poll(async () => {
      seen.add((await grid.getAttribute('data-playhead')) ?? '');
      return seen.size;
    }, { intervals: [40] })
    .toBeGreaterThanOrEqual(6);
  expect([...seen].every((value) => Number(value) >= -1 && Number(value) <= 15)).toBe(true);

  await page.getByTestId('play').click();
  await expect(editor).toHaveAttribute('data-playing', 'false');
  await expect(grid).toHaveAttribute('data-playhead', '-1');
});

test('auditioning a voice starts audio without starting the beat', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await page.getByTestId('audition-kick').click();
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await expect(editor).toHaveAttribute('data-playing', 'false');
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
});

test('Space plays and stops', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await page.locator('body').press('Space');
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await page.locator('body').press('Space');
  await expect(editor).toHaveAttribute('data-playing', 'false');
});

test('edits made while playing keep the beat running', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await page.getByTestId('play').click();
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await openSettings(page);
  await page.getByTestId('bpm').fill('160');
  await closeSettings(page);
  await chooseKit(page, '707');
  await page.locator('.sb-step[data-role="cymbal"][data-step="0"]').click();
  await expect.poll(async () => (await debug(page)).engineKit).toBe('707');
  const before = (await debug(page)).stats?.frames ?? 0;
  await expect.poll(async () => (await debug(page)).stats?.frames ?? 0).toBeGreaterThan(before + 10_000);
  await expect(editor).toHaveAttribute('data-playing', 'true');
});

test('the offline render of the same beat is not silent', async ({ page }) => {
  const render = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  const bpm = (await debug(page)).project.bpm;
  expect(render.frames).toBe(Math.floor((44100 * 240) / bpm + 0.5));
  expect(render.peak).toBeGreaterThan(0.1);
  expect(render.rms).toBeGreaterThan(0.01);
  expect(render.events.length).toBeGreaterThan(10);
});

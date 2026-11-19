import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeSettings, downloadBytes, exportVia, parseMidi, parseWav, scanner } from '../helpers';
import { beat, hitCount, holdScripts, holdTheRender, openMachine } from './helpers';

test.beforeEach(async ({ page }) => {
  await openMachine(page);
});

const status = (page: Page) => page.getByTestId('wav-export-status');
const said = (page: Page) => page.getByTestId('wav-export-said');
const chip = (page: Page) => page.getByTestId('wav-export-chip');
const chipSaid = (page: Page) => page.getByTestId('wav-export-chip-said');
const colorOf = (part: Locator) => part.evaluate((node) => getComputedStyle(node).color);

test('a WAV export is the pattern on the panel, rendered in a Worker', async ({ page }) => {
  let workers = 0;
  page.on('worker', () => {
    workers += 1;
  });
  const onThePage = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  expect(workers).toBe(0);

  const download = await exportVia(page, 'export-wav');
  expect(download.suggestedFilename()).toMatch(/\.wav$/);
  const wav = parseWav(await downloadBytes(download));
  expect(wav).toMatchObject({ channels: 2, sampleRate: 44100, bits: 24, frames: onThePage.frames });
  expect(wav.rms).toBeGreaterThan(0.02);
  expect(wav.peak).toBeLessThanOrEqual(1);
  expect(workers).toBe(1);

  await expect(status(page)).toHaveText(/^WAV exported at /);
  await expect(said(page)).toHaveText(/^WAV exported at /);
  await expect(said(page)).toHaveRole('status');
});

test('the 16-bit WAV and the MIDI file hold the same measure', async ({ page }) => {
  const now = await beat(page);
  const wav = parseWav(await downloadBytes(await exportVia(page, 'export-wav-16')));
  expect(wav).toMatchObject({ channels: 2, sampleRate: 44100, bits: 16, frames: Math.round((44100 * 240) / now.tempo) });
  expect(wav.rms).toBeGreaterThan(0.02);

  const midi = parseMidi(await downloadBytes(await exportVia(page, 'export-midi')));
  expect(midi.notes.filter((note) => note.on)).toHaveLength(hitCount(now.patterns[0]!));
  expect(midi.notes.every((note) => note.channel === 10)).toBe(true);
  expect(Math.round(60_000_000 / midi.tempoMicros)).toBe(now.tempo);
});

test('a render under way says so, to the eye and to a screen reader, and a second one waits', async ({ page }) => {
  const release = await holdTheRender(page);

  await page.getByTestId('export-menu').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-wav').click();
  await expect(status(page)).toHaveText('Rendering the WAV… 0%');
  // The sheet says it itself, so the chip outside it stands aside.
  await expect(chip(page)).toHaveCount(0);
  await expect(status(page)).toHaveAttribute('data-state', 'rendering');
  await expect(said(page)).toHaveText('Rendering the WAV…');

  // The sheet still answers while the render is out, and the menu says why a WAV cannot be asked for.
  await page.getByTestId('export-menu').click();
  for (const item of ['export-wav', 'export-wav-16']) {
    await expect(page.getByTestId(item)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId(item)).toContainText('One is rendering now');
    // It looks switched off as well: no hand over it, and its name dimmed beside the note that says why.
    await expect(page.getByTestId(item)).toHaveCSS('cursor', 'default');
    const name = await colorOf(page.getByTestId(item).locator('span').first());
    expect(name).not.toBe(await colorOf(page.getByTestId('export-midi').locator('span').first()));
    expect(name).not.toBe(await colorOf(page.getByTestId(item).locator('.sb-menu-note')));
  }
  await expect(page.getByTestId('export-midi')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('export-midi')).toHaveCSS('cursor', 'pointer');
  await page.keyboard.press('Escape');

  release();
  expect(parseWav(await downloadBytes(await download)).frames).toBeGreaterThan(0);
  await expect(status(page)).toHaveText(/^WAV exported at /);
  await page.getByTestId('export-menu').click();
  await expect(page.getByTestId('export-wav')).toContainText('24-bit stereo, one measure');
});

test('a render that cannot start says it failed, and the next one works', async ({ page }) => {
  await holdScripts(page, (route) => route.abort());
  await page.getByTestId('export-menu').click();
  await page.getByTestId('export-wav').click();
  await expect(status(page)).toHaveText('The WAV export failed');
  await expect(status(page)).toHaveAttribute('data-state', 'error');
  await expect(said(page)).toHaveText('The WAV export failed');
  await expect(page.getByTestId('notice')).toContainText('The WAV export failed');
  await closeSettings(page);
  await expect(chip(page)).toHaveText('The WAV export failed, open settings');
  await expect(chip(page)).toHaveAttribute('data-state', 'error');
  await expect(chipSaid(page)).toHaveText('The WAV export failed');

  await page.unroute('**/*.js');
  const wav = parseWav(await downloadBytes(await exportVia(page, 'export-wav')));
  expect(wav.frames).toBeGreaterThan(0);
  await expect(status(page)).toHaveText(/^WAV exported at /);
});

test('with the sheet closed, a chip counts the render up, says it is done, and goes', async ({ page }) => {
  const release = await holdTheRender(page);
  await page.getByTestId('export-menu').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-wav').click();
  await expect(status(page)).toHaveAttribute('data-state', 'rendering');
  await closeSettings(page);

  await expect(chip(page)).toBeVisible();
  await expect(chip(page)).toHaveAttribute('data-state', 'rendering');
  await expect(chip(page)).toHaveText('Rendering the WAV… 0%, open settings');
  await expect(chipSaid(page)).toHaveRole('status');
  await expect(chipSaid(page)).toHaveText('Rendering the WAV…');
  // It is clear of the footer's buttons, which are on the right.
  const box = (await chip(page).boundingBox())!;
  const settings = (await page.getByTestId('settings').boundingBox())!;
  expect(box.x + box.width).toBeLessThan(settings.x);
  expect((await scanner(page).analyze()).violations.map((violation) => violation.id)).toEqual([]);

  // A button: reached with the keyboard, it opens the sheet, which then says it all.
  await chip(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await expect(chip(page)).toHaveCount(0);
  await expect(chipSaid(page)).toHaveText('');
  await closeSettings(page);
  await expect(chip(page)).toBeVisible();

  release();
  expect(parseWav(await downloadBytes(await download)).frames).toBeGreaterThan(0);
  await expect(chip(page)).toHaveText('WAV exported, open settings');
  await expect(chip(page)).toHaveAttribute('data-state', 'done');
  await expect(chipSaid(page)).toHaveText(/^WAV exported at /);
  await expect(chip(page)).toHaveCount(0, { timeout: 10_000 });
  await expect(chipSaid(page)).toHaveText('');
});

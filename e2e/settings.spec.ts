import { expect, test } from '@playwright/test';
import { closeSettings, openEditor, openSettings } from './helpers';
import { beat, hitCount, step } from './ritm12/helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

const BURIED = ['beat-name', 'undo', 'redo', 'starter', 'clear', 'clear-everything', 'import', 'export-menu', 'draft-status'];

test('the page is the brand, the machine and a footer', async ({ page }) => {
  await expect(page.getByTestId('brand')).toBeVisible();
  await expect(page.getByTestId('panel')).toBeVisible();
  for (const id of BURIED) await expect(page.getByTestId(id)).toHaveCount(0);

  const made = page.getByTestId('made-by');
  await expect(made).toHaveText('built with by mm.coffee');
  await expect(made.getByRole('img', { name: 'love' })).toBeVisible();
  await expect(made.getByRole('link', { name: 'mm.coffee' })).toHaveAttribute('href', 'https://mm.coffee');

  // Credit on the left, cog on the right, both under the machine.
  const machine = (await page.getByTestId('panel').boundingBox())!;
  const text = (await made.boundingBox())!;
  const cog = (await page.getByTestId('settings').boundingBox())!;
  expect(text.y).toBeGreaterThan(machine.y + machine.height);
  expect(Math.abs(text.x - machine.x)).toBeLessThanOrEqual(2);
  expect(cog.x).toBeGreaterThan(text.x + text.width);
});

test('at full size the wordmark is 79.4px tall and the mascot a little shorter', async ({ page }) => {
  const mascot = (await page.getByTestId('brand-mascot').boundingBox())!;
  const wordmark = (await page.locator('.sb-wordmark').boundingBox())!;
  expect(mascot.height).toBeCloseTo(56.7, 0);
  expect(wordmark.height).toBeCloseTo(79.4, 0);
});

test('the cog opens settings, and Escape hands focus back to it', async ({ page }) => {
  const cog = page.getByTestId('settings');
  await expect(cog).toHaveAccessibleName('Settings');
  await cog.click();
  const sheet = page.getByTestId('settings-modal');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Settings' })).toBeVisible();
  for (const id of BURIED) await expect(page.getByTestId(id)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(cog).toBeFocused();

  // Clicking outside the sheet closes it too.
  await cog.click();
  await expect(sheet).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(sheet).toHaveCount(0);
});

test('Space plays the beat after settings is closed with the mouse', async ({ page }) => {
  await openSettings(page);
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('settings-modal')).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  await expect(page.getByTestId('settings-modal')).toHaveCount(0);
});

test('Escape in the beat name reverts it without closing settings', async ({ page }) => {
  await openSettings(page);
  const name = page.getByTestId('beat-name');
  const before = (await beat(page)).name;
  await name.fill('Half typed');
  await name.press('Escape');
  await expect(name).toHaveValue(before);
  expect((await beat(page)).name).toBe(before);
  await expect(page.getByTestId('settings-modal')).toBeVisible();
});

test('a pattern can be cleared, undone and reset to the starter patterns', async ({ page }) => {
  const starter = await beat(page);
  const hits = hitCount(starter.patterns[0]!);
  await openSettings(page);
  await expect(page.getByTestId('hit-count')).toHaveText(`${hits} hits in pattern А`);
  await expect(page.getByTestId('undo')).toBeDisabled();

  await page.getByTestId('clear').click();
  await expect(page.getByTestId('hit-count')).toHaveText('0 hits in pattern А');
  await expect(page.getByTestId('clear')).toBeDisabled();

  await page.getByTestId('undo').click();
  expect((await beat(page)).patterns).toEqual(starter.patterns);
  await page.getByTestId('redo').click();
  expect(hitCount((await beat(page)).patterns[0]!)).toBe(0);

  // Ctrl+Z works from the machine too.
  await closeSettings(page);
  await step(page, 5).click();
  expect(hitCount((await beat(page)).patterns[0]!)).toBe(1);
  await page.keyboard.press('ControlOrMeta+z');
  expect(hitCount((await beat(page)).patterns[0]!)).toBe(0);

  await openSettings(page);
  await page.getByTestId('starter').click();
  expect((await beat(page)).patterns).toEqual(starter.patterns);
});

test('everything can be cleared at once, stays cleared after a reload, and comes back with undo', async ({ page }) => {
  const starter = await beat(page);
  const blank = (now: Awaited<ReturnType<typeof beat>>) => now.patterns.every((pattern) => hitCount(pattern) === 0);
  expect(blank(starter)).toBe(false);

  await openSettings(page);
  await page.getByTestId('clear-everything').click();
  await expect(page.getByTestId('clear-everything')).toBeDisabled();
  const cleared = await beat(page);
  expect(blank(cleared)).toBe(true);
  // The knobs and the tempo are not part of what it clears.
  expect(cleared.mix).toEqual(starter.mix);
  expect(cleared.voices).toEqual(starter.voices);
  expect(cleared.tempo).toBe(starter.tempo);

  await page.getByTestId('undo').click();
  expect((await beat(page)).patterns).toEqual(starter.patterns);
  await page.getByTestId('redo').click();
  expect(blank(await beat(page))).toBe(true);

  await expect(page.getByTestId('draft-status')).toContainText('Draft saved in this browser');
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  expect(blank(await beat(page))).toBe(true);
});

test('a browser that stops keeping the draft says so, and names both ways to keep the beat', async ({ page }) => {
  // Storage that was there when the page loaded and then takes nothing more, as a full one does.
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key !== 'boombapbot.probe') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      write.call(this, key, value);
    };
  });
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await step(page, 2).click();
  await openSettings(page);
  const status = page.getByTestId('draft-status');
  await expect(status).toHaveAttribute('data-state', 'error');
  await expect(status).toContainText(
    'This browser is not saving drafts. To keep this beat, export the project file or save it to an account.',
  );
});

test('a browser with no storage from the start says so before anything is written', async ({ page }) => {
  // A private window that blocks storage throws as soon as the page reaches for it.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Access is denied for this document.', 'SecurityError');
      },
    });
  });
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await openSettings(page);
  const status = page.getByTestId('draft-status');
  await expect(status).toHaveAttribute('data-state', 'error');
  await expect(status).toContainText(
    'This browser is not saving drafts. To keep this beat, export the project file or save it to an account.',
  );
  const note = page.getByTestId('settings-modal').locator('.sb-hint');
  await expect(note).not.toContainText('saved in this browser');
  await expect(note).toContainText('save the beat to a free account from the account button in the footer');
});

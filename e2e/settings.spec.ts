import { expect, test } from '@playwright/test';
import { closeSettings, hitCount, openEditor, openSettings, project, stepButton } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

const BURIED = ['beat-name', 'undo', 'redo', 'starter', 'clear', 'import', 'export-menu', 'draft-status'];
// What settings no longer holds: the machine has its own tempo knob and no second editor.
const GONE = ['bpm', 'swing', 'mode-modern', 'mode-hardware', 'kit-808', 'grid'];

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
  for (const id of GONE) await expect(page.getByTestId(id)).toHaveCount(0);

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
  const before = (await project(page)).name;
  await name.fill('Half typed');
  await name.press('Escape');
  await expect(name).toHaveValue(before);
  expect((await project(page)).name).toBe(before);
  await expect(page.getByTestId('settings-modal')).toBeVisible();
});

test('settings list what the panel does not model yet', async ({ page }) => {
  await openSettings(page);
  const pending = page.getByTestId('panel-pending');
  await pending.locator('summary').click();
  await expect(pending.locator('li').first()).toBeVisible();
});

test('a rhythm can be cleared, undone and reset to the starter rhythms', async ({ page }) => {
  const starter = await project(page);
  const hits = hitCount(starter);
  await openSettings(page);
  await expect(page.getByTestId('hit-count')).toHaveText(`${hits} hits in 16 steps`);
  await expect(page.getByTestId('undo')).toBeDisabled();

  await page.getByTestId('clear').click();
  await expect(page.getByTestId('hit-count')).toHaveText('0 hits in 16 steps');
  await expect(page.getByTestId('clear')).toBeDisabled();
  expect(hitCount(await project(page))).toBe(0);

  await page.getByTestId('undo').click();
  expect((await project(page)).rhythms).toEqual(starter.rhythms);
  await page.getByTestId('redo').click();
  expect(hitCount(await project(page))).toBe(0);

  // Ctrl+Z works from the machine too.
  await closeSettings(page);
  await stepButton(page, 5).click();
  expect(hitCount(await project(page))).toBe(1);
  await page.keyboard.press('Control+z');
  expect(hitCount(await project(page))).toBe(0);

  await openSettings(page);
  await page.getByTestId('starter').click();
  expect((await project(page)).rhythms).toEqual(starter.rhythms);
});

import { expect, test } from '@playwright/test';
import { chooseMode, openEditor, openSettings, project } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

const BURIED = ['beat-name', 'bpm', 'swing', 'mode-hardware', 'undo', 'clear', 'import', 'export-menu'];

test('the page is the brand, the machine and a footer', async ({ page }) => {
  await expect(page.getByTestId('brand')).toBeVisible();
  // A new visit starts on the faceplate.
  await expect(page.getByTestId('editor')).toHaveAttribute('data-mode', 'hardware');
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

  await chooseMode(page, 'modern');
  await expect(page.getByTestId('grid')).toBeVisible();
  for (const id of BURIED) await expect(page.getByTestId(id)).toHaveCount(0);
});

test('the brand is two and a half times its old size', async ({ page }) => {
  const mascot = (await page.getByTestId('brand-mascot').boundingBox())!;
  expect(mascot.height).toBeCloseTo(105, 0);
});

test('the cog opens settings, and Escape hands focus back to it', async ({ page }) => {
  const cog = page.getByTestId('settings');
  await expect(cog).toHaveAccessibleName('Settings');
  await cog.click();
  const sheet = page.getByTestId('settings-sheet');
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
  await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
});

test('Escape in the beat name reverts it without closing settings', async ({ page }) => {
  await openSettings(page);
  const name = page.getByTestId('beat-name');
  const before = (await project(page)).name;
  await name.fill('Half typed');
  await name.press('Escape');
  await expect(name).toHaveValue(before);
  expect((await project(page)).name).toBe(before);
  await expect(page.getByTestId('settings-sheet')).toBeVisible();
});

test('Hardware settings list what the panel does not model yet', async ({ page }) => {
  await openSettings(page);
  const pending = page.getByTestId('panel-pending');
  await pending.locator('summary').click();
  await expect(pending.locator('li').first()).toBeVisible();
  await page.getByTestId('mode-modern').click();
  await expect(pending).toHaveCount(0);
});

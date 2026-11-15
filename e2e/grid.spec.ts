import { expect, test } from '@playwright/test';
import { hitCount, lane, openModern, openSettings, project, step } from './helpers';

test.beforeEach(async ({ page }) => {
  await openModern(page);
});

test('starts with an audible beat on eight 16-step lanes', async ({ page }) => {
  await expect(page.locator('.sb-lane')).toHaveCount(8);
  await expect(page.locator('.sb-step')).toHaveCount(8 * 16);
  const snapshot = await project(page);
  expect(hitCount(snapshot)).toBeGreaterThan(10);
  await openSettings(page);
  await expect(page.getByTestId('hit-count')).toContainText(`${hitCount(snapshot)} hits`);
  await expect(step(page, 'kick', 0)).toHaveAttribute('aria-pressed', 'true');
});

test('clicking a step toggles it', async ({ page }) => {
  const target = step(page, 'cymbal', 5);
  await expect(target).toHaveAttribute('aria-pressed', 'false');
  await target.click();
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  await expect(target).toHaveAttribute('aria-label', 'Cymbal, step 6, on, velocity 100');
  expect(lane(await project(page), 'cymbal')[5]).toBe(100);
  await target.click();
  await expect(target).toHaveAttribute('aria-pressed', 'false');
  expect(lane(await project(page), 'cymbal')[5]).toBe(0);
});

test('the grid works from the keyboard', async ({ page }) => {
  await step(page, 'snare', 0).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(step(page, 'snare', 2)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(step(page, 'snare', 2)).toHaveAttribute('aria-pressed', 'true');

  // Velocity up, then accent, then down.
  await page.keyboard.press('=');
  expect(lane(await project(page), 'snare')[2]).toBe(108);
  await page.keyboard.press('a');
  expect(lane(await project(page), 'snare')[2]).toBe(127);
  await expect(step(page, 'snare', 2)).toHaveAttribute('data-accent', 'true');
  await page.keyboard.press('-');
  expect(lane(await project(page), 'snare')[2]).toBe(119);

  // Down a lane, end of the row, and wrap around.
  await page.keyboard.press('ArrowDown');
  await expect(step(page, 'closed_hat', 2)).toBeFocused();
  await page.keyboard.press('End');
  await expect(step(page, 'closed_hat', 15)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(step(page, 'closed_hat', 0)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(step(page, 'closed_hat', 0)).toHaveAttribute('aria-pressed', 'false');
});

test('step velocity can be set on the velocity lane', async ({ page }) => {
  await step(page, 'kick', 4).focus();
  const bar = page.getByRole('slider', { name: 'Step 5 velocity' });
  await expect(bar).toHaveAttribute('aria-valuenow', '100');
  await bar.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(bar).toHaveAttribute('aria-valuenow', '108');
  expect(lane(await project(page), 'kick')[4]).toBe(108);
  await expect(page.getByTestId('velocity-readout')).toHaveText('Step 5: 108');
  await page.keyboard.press('Home');
  await expect(step(page, 'kick', 4)).toHaveAttribute('aria-pressed', 'false');
});

test('dragging on the velocity lane sets velocity', async ({ page }) => {
  await page.getByRole('button', { name: 'Select Bass Drum lane' }).click();
  const bar = page.getByRole('slider', { name: 'Step 2 velocity' });
  await bar.scrollIntoViewIfNeeded();
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.25);
  await page.mouse.up();
  const velocity = lane(await project(page), 'kick')[1]!;
  expect(velocity).toBeGreaterThan(85);
  expect(velocity).toBeLessThan(105);
});

test('clear empties the pattern and undo brings it back', async ({ page }) => {
  const before = await project(page);
  await openSettings(page);
  await page.getByTestId('clear').click();
  expect(hitCount(await project(page))).toBe(0);
  await expect(page.locator('.sb-step[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByTestId('clear')).toBeDisabled();

  await page.getByTestId('undo').click();
  expect((await project(page)).pattern).toEqual(before.pattern);

  await page.getByTestId('clear').click();
  await page.getByTestId('starter').click();
  expect(hitCount(await project(page))).toBe(hitCount(before));
});

test('tempo and swing controls edit the project', async ({ page }) => {
  await openSettings(page);
  const bpm = page.getByTestId('bpm');
  await bpm.fill('140');
  await bpm.press('Enter');
  expect((await project(page)).bpm).toBe(140);
  await page.getByRole('button', { name: 'Faster' }).click();
  expect((await project(page)).bpm).toBe(141);
  // Out-of-range input is clamped when committed, never stored as typed.
  await bpm.fill('9999');
  expect((await project(page)).bpm).toBe(141);
  await bpm.blur();
  expect((await project(page)).bpm).toBe(240);
  await expect(bpm).toHaveValue('240');
  await bpm.fill('');
  await bpm.blur();
  await expect(bpm).toHaveValue('240');

  await page.getByRole('slider', { name: 'Swing percent' }).focus();
  await page.keyboard.press('End');
  expect((await project(page)).swing).toBe(75);
  await expect(page.getByTestId('swing-value')).toHaveText('75%');
});

test('the header shows the mascot and the wordmark', async ({ page }) => {
  const mascot = page.getByTestId('brand-mascot');
  await expect(mascot).toBeVisible();
  await expect
    .poll(() => mascot.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
  const wordmark = page.getByRole('img', { name: 'boombapbot' });
  await expect(wordmark).toBeVisible();

  // Mascot to the left of the wordmark, and under twice its height: the
  // wordmark is all capitals, so it sits lower than the mascot stands.
  const mascotBox = (await mascot.boundingBox())!;
  const wordmarkBox = (await wordmark.boundingBox())!;
  expect(mascotBox.x + mascotBox.width).toBeLessThanOrEqual(wordmarkBox.x);
  expect(mascotBox.height).toBeGreaterThan(wordmarkBox.height * 1.5);
  expect(mascotBox.height).toBeLessThan(wordmarkBox.height * 2);
  // Vertically centred on each other.
  const offset = mascotBox.y + mascotBox.height / 2 - (wordmarkBox.y + wordmarkBox.height / 2);
  expect(Math.abs(offset)).toBeLessThanOrEqual(2);
});

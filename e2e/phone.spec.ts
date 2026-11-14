import { expect, test } from '@playwright/test';
import { debug, lane, openEditor, project, step } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('the grid fits a phone and has touch-sized steps', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const box = (await step(page, 'kick', 0).boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(36);
  expect(box.height).toBeGreaterThanOrEqual(40);

  // Each lane wraps into two rows of eight.
  const first = (await step(page, 'kick', 0).boundingBox())!;
  const eighth = (await step(page, 'kick', 7).boundingBox())!;
  const ninth = (await step(page, 'kick', 8).boundingBox())!;
  expect(eighth.y).toBe(first.y);
  expect(ninth.y).toBeGreaterThan(first.y);
  expect(ninth.x).toBe(first.x);
});

test('tapping toggles steps and the docked Play starts audio', async ({ page }) => {
  await step(page, 'open_hat', 3).tap();
  await expect(step(page, 'open_hat', 3)).toHaveAttribute('aria-pressed', 'true');
  expect(lane(await project(page), 'open_hat')[3]).toBe(100);

  const dock = page.getByTestId('dock-play');
  await expect(dock).toBeVisible();
  await dock.tap();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'running');
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.01);
  await dock.tap();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
});

test('kit buttons are reachable by touch', async ({ page }) => {
  await page.getByTestId('kit-909').tap();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-kit', '909');
  const box = (await page.getByTestId('kit-909').boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
});

import { expect, test } from '@playwright/test';
import { beat, openMachine } from './helpers';

test('on a phone the picture keeps a workable size and scrolls sideways, or fits the screen', async ({ page }) => {
  await openMachine(page);
  const scroll = page.locator('.rt-scroll');
  const widths = () => scroll.evaluate((node) => ({ inner: node.scrollWidth, outer: node.clientWidth }));
  const zoomed = await widths();
  expect(zoomed.inner).toBe(900);
  expect(zoomed.outer).toBeLessThan(500);
  // The page itself never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByTestId('fit').click();
  const fitted = await widths();
  expect(fitted.inner).toBe(fitted.outer);
  await expect(page.getByTestId('fit')).toHaveText('Zoom in');
});

test('on a phone an instrument is chosen from the strip, and the dock starts the machine', async ({ page }) => {
  await openMachine(page);
  await expect(page.locator('.rt-touch')).toBeVisible();
  await page.getByTestId('strip-open_hat').click();
  expect((await beat(page)).panel.selected).toBe('open_hat');
  await page.getByTestId('dock-play').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  await expect(page.getByTestId('dock-bpm')).toHaveText(String((await beat(page)).tempo));
  await page.getByTestId('dock-play').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
});

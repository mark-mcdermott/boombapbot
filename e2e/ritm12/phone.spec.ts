import { expect, test } from '@playwright/test';
import { beat } from './helpers';

// A phone gets the phone's panel, which phone-panel.spec.ts covers. These hold
// what a phone gets when its address asks for the picture instead.

async function openPicture(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?panel=picture');
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('plate')).toBeVisible();
}

test('a phone that asks for the picture gets it at a workable size, scrolling sideways or fitted to the screen', async ({ page }) => {
  await openPicture(page);
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

test('with the picture on a phone an instrument is chosen from the strip, and the dock starts the machine', async ({ page }) => {
  await openPicture(page);
  await expect(page.locator('.rt-touch')).toBeVisible();
  await page.getByTestId('strip-open_hat').click();
  expect((await beat(page)).panel.selected).toBe('open_hat');
  await page.getByTestId('dock-play').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  await expect(page.getByTestId('dock-bpm')).toHaveText(String((await beat(page)).tempo));
  await page.getByTestId('dock-play').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
});

import { expect, test } from '@playwright/test';
import {
  chooseKit,
  chooseMode,
  debug,
  draftOnKit,
  faceplateIsCredited,
  faceplates,
  hitCount,
  lane,
  openEditor,
  project,
  step,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
  await chooseKit(page, '606');
});

test('hardware and modern editors share one beat', async ({ page }) => {
  const before = await project(page);
  const panel = page.getByTestId('panel');
  await expect(panel).toBeVisible();
  expect(await project(page)).toEqual(before);

  // Select the snare on the panel and program two steps.
  await page.getByTestId('panel-voice-snare').click();
  await expect(page.getByTestId('panel-voice-snare')).toHaveAttribute('aria-checked', 'true');
  const steps = panel.locator('[data-panel-step]');
  await expect(steps).toHaveCount(16);
  await expect(steps.nth(4)).toHaveAttribute('aria-pressed', 'true');
  await steps.nth(6).click();
  await steps.nth(4).click();
  await expect(steps.nth(6)).toHaveAttribute('aria-pressed', 'true');
  await expect(steps.nth(4)).toHaveAttribute('aria-pressed', 'false');

  // Back in Modern the same edits are there, and nothing else moved.
  await chooseMode(page, 'modern');
  await expect(step(page, 'snare', 6)).toHaveAttribute('aria-pressed', 'true');
  await expect(step(page, 'snare', 4)).toHaveAttribute('aria-pressed', 'false');
  const after = await project(page);
  expect(lane(after, 'kick')).toEqual(lane(before, 'kick'));
  expect(lane(after, 'clap')).toEqual(lane(before, 'clap'));

  // A Modern edit shows up on the panel.
  await step(page, 'snare', 9).click();
  await chooseMode(page, 'hardware');
  await expect(panel.locator('[data-panel-step]').nth(9)).toHaveAttribute('aria-pressed', 'true');
});

test('hits the panel cannot show are kept and pointed out', async ({ page }) => {
  const before = await project(page);
  expect(lane(before, 'clap').some((velocity) => velocity > 0)).toBe(true);
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
  const steps = page.getByTestId('panel').locator('[data-panel-step]');
  await steps.nth(0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(steps.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(steps.nth(15)).toBeFocused();
});

for (const kit of ['606', '707', '808', '909']) {
  test(`the ${kit} panel programs its own instruments`, async ({ page }) => {
    await chooseKit(page, kit);
    const panel = page.getByTestId('panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-panel-step]')).toHaveCount(16);

    // The panel is the faceplate image where the build ships one, and is
    // drawn from the same layout where it does not. Both must work.
    const image = (await faceplates(page))[kit];
    await expect(panel).toHaveAttribute('data-photo', image ? 'photo' : 'drawn');
    if (image) {
      const photo = panel.locator('img.sb-panel-photo');
      await expect(photo).toHaveAttribute('src', new RegExp(`${image}$`));
      await expect
        .poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth))
        .toBeGreaterThan(0);
      await expect(panel.locator('.sb-knob-photo')).not.toHaveCount(0);
      await expect(panel.locator('.sb-panel-key')).toHaveCount(0);

      // A shipped photograph is shown with its credit, source and licence.
      // Artwork drawn for boombapbot has nobody to credit.
      const credit = page.getByTestId('panel-credit');
      if (faceplateIsCredited(kit)) {
        await expect(credit).toBeVisible();
        await expect(credit).toContainText(/by \S+/);
        await expect(credit.locator('a[href^="https://commons.wikimedia.org/"]')).toHaveCount(1);
        await expect(credit.locator('a[href^="https://creativecommons.org/licenses/"]')).toHaveCount(1);
      } else {
        await expect(credit).toHaveCount(0);
      }
    } else {
      await expect(page.getByTestId('panel-credit')).toHaveCount(0);
      await expect(panel.locator('img.sb-panel-photo')).toHaveCount(0);
      await expect(panel.locator('.sb-panel-key')).toHaveCount(16);
    }

    // Every instrument the panel offers selects its own lane.
    const voices = panel.locator('[data-testid^="panel-voice-"]');
    const count = await voices.count();
    expect(count).toBeGreaterThanOrEqual(7);
    for (let i = 0; i < count; i += 1) {
      const voice = voices.nth(i);
      const role = (await voice.getAttribute('data-testid'))!.replace('panel-voice-', '');
      await voice.click();
      await expect(voice).toHaveAttribute('aria-checked', 'true');
      const before = lane(await project(page), role);
      const target = before.findIndex((velocity) => velocity === 0);
      await panel.locator('[data-panel-step]').nth(target).click();
      const after = lane(await project(page), role);
      expect(after[target]).toBe(100);
      expect(after.filter((_, index) => index !== target)).toEqual(before.filter((_, index) => index !== target));
    }

    // Nothing but the faceplate and its credit: the touch strip is for phones.
    await expect(page.getByTestId('strip-voice-snare')).toBeHidden();

    // Step and control areas stay inside the faceplate and do not overlap.
    const boxes = await panel.locator('[data-panel-step]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      }),
    );
    boxes.forEach((box, index) => {
      expect(box.width).toBeGreaterThan(20);
      expect(box.height).toBeGreaterThan(20);
      if (index > 0) expect(box.left).toBeGreaterThanOrEqual(boxes[index - 1]!.right - 0.5);
    });
  });
}

test('a faceplate image that fails to load falls back to the drawn panel', async ({ page }) => {
  const shipped = await faceplates(page);
  const kit = Object.keys(shipped)[0];
  test.skip(!kit, 'this build ships no faceplate images');
  await chooseKit(page, kit!);
  await draftOnKit(page, kit!);
  // The editor opens on the faceplate, so fail the image on a fresh load.
  await page.route(`**/${shipped[kit!]}`, (route) => route.abort());
  await page.reload();
  const panel = page.getByTestId('panel');
  await expect(panel).toHaveAttribute('data-photo', 'drawn');
  await expect(panel.locator('.sb-panel-key')).toHaveCount(16);
  await panel.locator('[data-panel-step]').nth(3).click();
  await expect(panel.locator('[data-panel-step]').nth(3)).toHaveAttribute('aria-pressed', 'true');
});

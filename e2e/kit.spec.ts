import { expect, test } from '@playwright/test';
import { debug, openEditor, project } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('changing kit keeps the rhythm and changes the sound', async ({ page }) => {
  const before = await project(page);
  const renders: Record<string, Awaited<ReturnType<NonNullable<Window['__boombapbot']>['renderLoop']>>> = {};

  for (const kit of ['606', '707', '808', '909']) {
    await page.getByTestId(`kit-${kit}`).click();
    await expect(page.getByTestId('editor')).toHaveAttribute('data-kit', kit);
    await expect(page.getByTestId(`kit-${kit}`)).toHaveAttribute('aria-checked', 'true');

    const after = await project(page);
    expect(after.kit.id).toBe(kit);
    expect(after.pattern).toEqual(before.pattern);
    expect(after.bpm).toBe(before.bpm);
    expect(after.swing).toBe(before.swing);
    renders[kit] = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  }

  // Same hits at the same frames through every kit.
  const reference = renders['606']!;
  for (const kit of ['707', '808', '909']) {
    expect(renders[kit]!.events).toEqual(reference.events);
    expect(renders[kit]!.frames).toBe(reference.frames);
    expect(renders[kit]!.rms).toBeGreaterThan(0.01);
  }
  // Different sound: no two kits render at the same level.
  const levels = Object.values(renders).map((render) => render.rms.toFixed(4));
  expect(new Set(levels).size).toBe(4);
});

test('lane names follow the kit and stand-in voices are marked', async ({ page }) => {
  await page.getByTestId('kit-606').click();
  const clap = page.getByTestId('lane-clap');
  await expect(clap).toContainText('Snare Accent');
  await expect(clap.locator('.sb-badge')).toHaveText('stand-in');
  await expect(page.getByTestId('kit-note')).toContainText('Clap plays Snare Accent');

  await page.getByTestId('kit-909').click();
  await expect(clap).toContainText('Hand Clap');
  await expect(clap.locator('.sb-badge')).toHaveCount(0);
  await expect(page.getByTestId('lane-cymbal')).toContainText('Crash');
});

test('a kit switch reaches the running engine', async ({ page }) => {
  await page.getByTestId('play').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'running');
  for (const kit of ['909', '606']) {
    await page.getByTestId(`kit-${kit}`).click();
    await expect.poll(async () => (await debug(page)).engineKit).toBe(kit);
  }
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
});

test('the kit picker works from the keyboard', async ({ page }) => {
  await page.getByTestId('kit-808').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('kit-909')).toBeFocused();
  expect((await project(page)).kit.id).toBe('909');
  await page.keyboard.press('Home');
  expect((await project(page)).kit.id).toBe('606');
});

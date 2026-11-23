import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { exportVia, downloadBytes, storedDraft } from '../helpers';
import { DRAFT_KEY, EARLIER_BEAT, EARLIER_DRAFT_KEY, beat, openMachine, step, stepsOn } from './helpers';

test('the beat is kept in this browser and comes back on the next visit', async ({ page }) => {
  await openMachine(page);
  await page.getByTestId('pattern-4').click();
  await page.getByTestId('voice-perc').click();
  await step(page, 6).click();
  await page.getByTestId('size').click();
  await expect.poll(async () => (await storedDraft<{ size: number }>(page, DRAFT_KEY))?.size).toBe(12);
  await page.reload();
  await expect(page.getByTestId('plate')).toBeVisible();
  const back = await beat(page);
  expect(back).toMatchObject({ machine: 'ritm12', schemaVersion: 4, size: 12, panel: { pattern: 3, selected: 'perc' } });
  expect(stepsOn(back.patterns[3]!.steps.perc)).toEqual([6]);
  await expect(step(page, 6)).toHaveAttribute('aria-pressed', 'true');
});

test('a draft left by the earlier machine opens as a beat for this one, and is left where it was', async ({ page }) => {
  await page.addInitScript(
    ([key, text]) => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(key!, text!);
      }
    },
    [EARLIER_DRAFT_KEY, EARLIER_BEAT],
  );
  await openMachine(page);
  const notice = page.getByTestId('notice');
  await expect(notice).toContainText('came from an earlier version');
  await expect(notice).toContainText('is now a РИТМ-12 beat');
  await expect(notice).toContainText('Rhythm 1, version A, is now pattern А.');
  const opened = await beat(page);
  expect(opened).toMatchObject({ machine: 'ritm12', name: 'Mixed rhythms fixture', tempo: 124 });
  expect(opened.patterns[0]!.steps.kick).toBe('x...x...x..xx...');
  expect(opened.patterns[0]!.accents).toBe('x.......x.......');
  // The earlier draft is untouched, and this machine keeps its own in IndexedDB.
  expect(await page.evaluate((key) => localStorage.getItem(key), EARLIER_DRAFT_KEY)).toBe(EARLIER_BEAT);
  await expect.poll(async () => (await storedDraft<{ name: string }>(page, DRAFT_KEY))?.name).toBe('Mixed rhythms fixture');
  await page.reload();
  await expect(page.getByTestId('plate')).toBeVisible();
  await expect(page.getByTestId('notice')).toHaveCount(0);
  expect((await beat(page)).patterns[0]!.steps.kick).toBe('x...x...x..xx...');
});

test('a file from the earlier machine imports as a beat for this one, and undo brings the old beat back', async ({ page }) => {
  await openMachine(page);
  const before = await beat(page);
  await page.getByTestId('import-input').setInputFiles({
    name: 'old.boombapbot.json',
    mimeType: 'application/json',
    buffer: Buffer.from(EARLIER_BEAT),
  });
  await expect(page.getByTestId('notice')).toContainText('Imported “Mixed rhythms fixture”.');
  await expect(page.getByTestId('notice')).toContainText('Its version B was left behind.');
  expect((await beat(page)).tempo).toBe(124);
  await page.keyboard.press('ControlOrMeta+z');
  expect((await beat(page)).patterns).toEqual(before.patterns);
});

test('a beat that names an effect of the upgrade opens, plays without it, says so, and keeps its name until another is chosen', async ({ page }) => {
  await openMachine(page);
  await page.getByTestId('import-input').setInputFiles({
    name: 'paid.boombapbot.json',
    mimeType: 'application/json',
    buffer: readFileSync('packages/machine-ritm12/fixtures/paid-effect.project.json'),
  });
  await expect(page.getByTestId('notice')).toContainText('Imported “Paid effect fixture”.');
  expect((await beat(page)).effect).toEqual({ kind: 'crusher', mix: 0.6 });
  const selector = page.getByTestId('effect');
  const label = page.getByTestId('effect-label');
  await expect(selector).toHaveAttribute('aria-label', /Crusher, which comes with the upgrade and is not playing/);
  await expect(label).toHaveAttribute('data-effect', 'crusher');
  await expect(label).toHaveAttribute('data-left-out', 'true');
  // The selector reaches only the four everyone has: from here its next is its first.
  await selector.click();
  expect((await beat(page)).effect.kind).toBe('delay');
  await expect(label).not.toHaveAttribute('data-left-out');
  for (let press = 0; press < 4; press += 1) await selector.click();
  expect((await beat(page)).effect.kind).toBe('delay');
});

test('the project file names its machine and comes back in as it went out', async ({ page }) => {
  await openMachine(page);
  await page.getByTestId('voice-tom').click();
  await page.getByTestId('pattern-3').click();
  await step(page, 9).click();
  const written = await beat(page);
  const file = JSON.parse((await downloadBytes(await exportVia(page, 'export-project'))).toString('utf8')) as { machine: string; schemaVersion: number };
  expect(file).toMatchObject({ machine: 'ritm12', schemaVersion: 4 });
  await page.getByTestId('settings-close').click();
  await page.getByTestId('clear-pattern').click();
  await page.getByTestId('import-input').setInputFiles({
    name: 'back.boombapbot.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await expect(page.getByTestId('notice')).toContainText('Imported');
  expect((await beat(page)).patterns).toEqual(written.patterns);
});

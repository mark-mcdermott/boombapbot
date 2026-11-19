import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openSettings, storedDraft } from './helpers';
import { DRAFT_KEY, beat, step, stepsOn, type Beat } from './ritm12/helpers';

/** A beat of this machine's own version, as it was kept in localStorage before IndexedDB. */
const KEPT_BEAT = readFileSync('packages/machine-ritm12/fixtures/four-patterns.project.json', 'utf8');

const kickSteps = async (page: Page) => {
  const now = await beat(page);
  return stepsOn(now.patterns[now.panel.pattern]!.steps.kick);
};
const keptKicks = async (page: Page) => {
  const kept = await storedDraft<Beat>(page, DRAFT_KEY);
  return kept ? stepsOn(kept.patterns[kept.panel.pattern]!.steps.kick) : null;
};

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
}

/** Turns on a kick step that is off, the first of `numbers`, and says which. */
async function addKick(page: Page, numbers: number[]): Promise<number> {
  await page.getByTestId('voice-kick').click();
  const on = await kickSteps(page);
  const number = numbers.find((candidate) => !on.includes(candidate));
  if (number === undefined) throw new Error(`kick steps ${numbers.join(', ')} are all on already`);
  await step(page, number).click();
  expect(await kickSteps(page)).toContain(number);
  return number;
}

test('a draft kept in localStorage moves to IndexedDB on the first visit, and the old copy goes', async ({ page }) => {
  await page.addInitScript(
    ([key, text]) => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(key!, text!);
      }
    },
    [DRAFT_KEY, KEPT_BEAT],
  );
  await open(page);
  expect(await beat(page)).toMatchObject({ id: 'fixture-four-patterns', name: 'Four patterns fixture', tempo: 96 });
  await expect(page.getByTestId('notice')).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY)).toBeNull();
  expect(await storedDraft<Beat>(page, DRAFT_KEY)).toMatchObject({ id: 'fixture-four-patterns', tempo: 96 });

  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  expect(await beat(page)).toMatchObject({ id: 'fixture-four-patterns', tempo: 96 });
});

test('a browser that refuses IndexedDB says it is not saving drafts, and the machine still works', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new DOMException('The user denied permission to access the database.', 'SecurityError');
      },
    });
  });
  await open(page);
  await addKick(page, [3, 4, 6]);
  await openSettings(page);
  const status = page.getByTestId('draft-status');
  await expect(status).toHaveAttribute('data-state', 'error');
  await expect(status).toContainText('This browser is not saving drafts.');
  await expect(page.getByTestId('settings-modal').locator('.sb-hint')).not.toContainText('saved in this browser');
  // Nothing went to localStorage in its place.
  expect(await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY)).toBeNull();
});

test('a change is kept when the tab closes straight after it', async ({ context }) => {
  const page = await context.newPage();
  await open(page);
  const number = await addKick(page, [6, 7, 8]);
  await page.close({ runBeforeUnload: true });

  const again = await context.newPage();
  await open(again);
  expect(await kickSteps(again)).toContain(number);
});

test.describe('two tabs on one draft', () => {
  test('the second tab is told the first keeps the draft, and keeps nothing itself', async ({ context }) => {
    const first = await context.newPage();
    await open(first);
    const kept = await addKick(first, [2, 3, 4]);
    await expect.poll(() => keptKicks(first)).toContain(kept);

    const second = await context.newPage();
    await open(second);
    const told = second.getByTestId('draft-elsewhere');
    await expect(told).toContainText('This beat is open in another tab, which is saving it. Changes here are not saved.');
    await expect(first.getByTestId('draft-elsewhere')).toHaveCount(0);
    await openSettings(second);
    await expect(second.getByTestId('draft-status')).toHaveAttribute('data-state', 'elsewhere');
    await expect(second.getByTestId('settings-modal').locator('.sb-hint')).not.toContainText('saved in this browser');
    await second.getByTestId('settings-close').click();

    // A change in the second tab is not written over the first tab's draft.
    const notKept = await addKick(second, [14, 16, 12]);
    await second.waitForTimeout(800);
    expect(await keptKicks(first)).not.toContain(notKept);
    expect(await keptKicks(first)).toContain(kept);
  });

  test('working in the second tab brings the first tab’s beat across, and the first stops saving', async ({ context }) => {
    const first = await context.newPage();
    await open(first);
    const second = await context.newPage();
    await open(second);
    await expect(second.getByTestId('draft-elsewhere')).toBeVisible();
    const secondOnly = await addKick(second, [15, 16, 14]);

    // The first tab's newest change is not written yet when the second asks.
    await addKick(first, [10, 12, 8]);
    const firstSteps = await kickSteps(first);
    await second.getByTestId('draft-work-here').click();

    await expect(second.getByTestId('draft-elsewhere')).toHaveCount(0);
    await expect(second.getByTestId('notice')).toContainText(
      'This tab is saving the beat now. It has the other tab’s changes; Undo brings back what was here.',
    );
    expect(await kickSteps(second)).toEqual(firstSteps);
    await expect(first.getByTestId('draft-elsewhere')).toBeVisible();

    // Undo brings back what the second tab had.
    await second.keyboard.press('ControlOrMeta+z');
    expect(await kickSteps(second)).toContain(secondOnly);
    await second.keyboard.press('ControlOrMeta+Shift+z');
    expect(await kickSteps(second)).toEqual(firstSteps);

    // Only the second tab writes now.
    const later = await addKick(second, [2, 3, 4]);
    await expect.poll(() => keptKicks(second)).toContain(later);
    const ignored = await addKick(first, [5, 6, 7].filter((number) => number !== later));
    await first.waitForTimeout(800);
    expect(await keptKicks(second)).not.toContain(ignored);

    await second.reload();
    await expect(second.getByTestId('editor')).toBeVisible();
    expect(await kickSteps(second)).toContain(later);
  });
});

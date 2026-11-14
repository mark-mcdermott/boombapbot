import { expect, test } from '@playwright/test';
import { hitCount, lane, openEditor, project, step } from './helpers';

test('the draft is saved locally and restored on reload', async ({ page }) => {
  await openEditor(page);
  await expect(page.getByTestId('draft-status')).toHaveAttribute('data-origin', 'new');

  await step(page, 'high_tom', 2).click();
  await step(page, 'kick', 0).click(); // off
  await page.getByTestId('bpm').fill('97');
  await page.getByTestId('bpm').press('Enter');
  await page.getByTestId('kit-707').click();
  await page.getByTestId('beat-name').fill('Reload test');
  await page.getByTestId('beat-name').press('Enter');
  const before = await project(page);
  await expect(page.getByTestId('draft-status')).toContainText('Draft saved in this browser');

  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  const after = await project(page);
  expect(after).toEqual(before);
  expect(after.bpm).toBe(97);
  expect(after.kit.id).toBe('707');
  expect(after.name).toBe('Reload test');
  expect(lane(after, 'high_tom')[2]).toBe(100);
  expect(lane(after, 'kick')[0]).toBe(0);
  await expect(page.getByTestId('draft-status')).toHaveAttribute('data-origin', 'restored');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-kit', '707');
  await expect(page.getByTestId('beat-name')).toHaveValue('Reload test');
  await expect(step(page, 'high_tom', 2)).toHaveAttribute('aria-pressed', 'true');
});

test('an unreadable draft is set aside and a starter beat loads', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('boombapbot.draft.v1', '{"format":"boombapbot.project","schemaVersion":1,"bpm":"fast"');
    }
  });
  await openEditor(page);
  await expect(page.getByTestId('notice')).toContainText('could not be read');
  expect(hitCount(await project(page))).toBeGreaterThan(10);
  const kept = await page.evaluate(() => localStorage.getItem('boombapbot.draft.unreadable'));
  expect(kept).toContain('"bpm":"fast"');

  // The replacement draft is valid, so the next load restores it quietly.
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('notice')).toHaveCount(0);
  await expect(page.getByTestId('draft-status')).toHaveAttribute('data-origin', 'restored');
});

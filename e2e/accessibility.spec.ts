import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openEditor } from './helpers';

function summarize(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
  }));
}

test('the Modern editor has no detectable accessibility violations', async ({ page }) => {
  await openEditor(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(summarize(results.violations)).toEqual([]);
});

test('the Hardware editor has no detectable accessibility violations', async ({ page }) => {
  await openEditor(page);
  for (const kit of ['606', '909']) {
    await page.getByTestId(`kit-${kit}`).click();
    await page.getByTestId('mode-hardware').click();
    await expect(page.getByTestId('panel')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(summarize(results.violations)).toEqual([]);
    await page.getByTestId('mode-modern').click();
  }
});

test('every control has an accessible name', async ({ page }) => {
  await openEditor(page);
  const unnamed = await page.evaluate(() => {
    const controls = document.querySelectorAll('button, input, [role="slider"], [role="radio"]');
    return [...controls]
      .filter((element) => {
        const input = element as HTMLInputElement;
        const label =
          element.getAttribute('aria-label') ||
          element.textContent?.trim() ||
          (input.labels && input.labels.length > 0 ? input.labels[0]!.textContent : '');
        return !label;
      })
      .map((element) => element.outerHTML.slice(0, 120));
  });
  expect(unnamed).toEqual([]);
});

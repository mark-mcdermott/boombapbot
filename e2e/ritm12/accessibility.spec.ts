import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openSettings } from '../helpers';
import { openMachine } from './helpers';

function summarize(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
  }));
}

test('the machine has no detectable accessibility violations, stopped, playing or in settings', async ({ page }) => {
  await openMachine(page);
  expect(summarize((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
  await page.getByTestId('write').click();
  await page.getByTestId('play').click();
  expect(summarize((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
  await page.getByTestId('stop').click();
  await openSettings(page);
  expect(summarize((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
});

test('every control has an accessible name in English, whatever is lettered on the picture', async ({ page }) => {
  await openMachine(page);
  const names = await page.locator('.rt-key, .rt-knob').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
  expect(names.every((name) => /^[A-Z]/.test(name))).toBe(true);
  expect(new Set(names).size).toBe(names.length);
  await expect(page.getByRole('slider', { name: 'Tempo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kick (БАС)' })).toHaveAttribute('aria-pressed', 'true');
});

test('the step keys are walked with the arrow keys', async ({ page }) => {
  await openMachine(page);
  await page.getByTestId('step-1').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('step-2')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('step-16')).toBeFocused();
});

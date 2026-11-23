import { expect, test } from '@playwright/test';
import { accountFromSignUpToDeletion, openApp } from './shell-account';

// The desktop app's page in a browser. It carries none of the site's pages:
// under the machine are a license key to enter, its settings and the
// account, which lives on the site's server as the phone app's does.

test('the footer has a license key to enter, the light switch, the settings and the account, and nothing of the site', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.sb-footer .sb-footer-icon')).toHaveCount(4);
  await expect(page.getByTestId('upgrade')).toBeVisible();
  await expect(page.getByTestId('light-toggle')).toBeVisible();
  await expect(page.getByTestId('settings')).toBeVisible();
  await expect(page.getByTestId('account')).toBeVisible();
  await expect(page.getByTestId('nav-merch')).toHaveCount(0);
  await expect(page.getByTestId('cart')).toHaveCount(0);
});

test('an account is made, logged in to, kept across a restart, and deleted, with no cookie', async ({ page, context }) => {
  await accountFromSignUpToDeletion(page, context);
});

test('a license key is entered with nobody logged in, and nothing is sold', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('upgrade').click();
  const form = page.getByTestId('upgrade-key-form');
  await expect(form).toContainText('unlocks the upgrade on this device. It needs no account.');
  await expect(page.getByTestId('upgrade-buy')).toHaveCount(0);
  await expect(page.getByTestId('upgrade-back')).toHaveCount(0);

  // The app's page reaches the site's server from another origin, and is answered.
  await form.getByTestId('upgrade-key-input').fill('BOOM-00000-00000-00000-00000');
  await form.getByTestId('upgrade-submit').click();
  await expect(page.getByTestId('upgrade-problem')).toHaveText('That is not a license key I know.');

  await page.getByTestId('upgrade-to-lost').click();
  await expect(page.getByTestId('upgrade-lost-form')).toBeVisible();
  await page.getByTestId('upgrade-back').click();
  await expect(form).toBeVisible();
});

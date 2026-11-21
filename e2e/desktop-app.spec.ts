import { expect, test } from '@playwright/test';
import { accountFromSignUpToDeletion, openApp } from './shell-account';

// The desktop app's page in a browser. It carries none of the site's pages:
// under the machine are its settings and the account, which lives on the
// site's server as the phone app's does.

test('the footer has the settings and the account, and nothing of the site', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.sb-footer .sb-footer-icon')).toHaveCount(2);
  await expect(page.getByTestId('settings')).toBeVisible();
  await expect(page.getByTestId('account')).toBeVisible();
  await expect(page.getByTestId('nav-merch')).toHaveCount(0);
  await expect(page.getByTestId('upgrade')).toHaveCount(0);
  await expect(page.getByTestId('cart')).toHaveCount(0);
});

test('an account is made, logged in to, kept across a restart, and deleted, with no cookie', async ({ page, context }) => {
  await accountFromSignUpToDeletion(page, context);
});

import { expect, test } from '@playwright/test';
import { ACCOUNTS_URL } from './accounts-server';
import { accountFromSignUpToDeletion, openApp } from './shell-account';

// The phone app's page in a phone's browser. Its account lives on the site's
// server, which it reaches from another origin with a token and no cookie,
// as the app does from inside a phone.

test('the footer has the pages, the shop, the settings and the account', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.sb-footer-word:visible')).toHaveText(['About', 'Docs', 'Manifesto', 'Policies', 'Merch', 'Settings', 'Account']);
  await expect(page.getByTestId('nav-merch')).toHaveAttribute('href', `${ACCOUNTS_URL}/?cart=open`);
  await expect(page.getByTestId('upgrade')).toHaveCount(0);
  await expect(page.getByTestId('cart')).toHaveCount(0);
});

test('a page of words opens in place of the machine and leads back to it', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('nav-docs').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to use РИТМ-12');
  await expect(page.getByTestId('editor')).toBeHidden();
  await expect(page.getByTestId('account')).toBeHidden();
  await page.getByTestId('top-machine').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('site-page')).toHaveCount(0);
});

test('an account is made, logged in to, kept across a restart, and deleted, with no cookie', async ({ page, context }) => {
  await accountFromSignUpToDeletion(page, context);
});

import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, fill } from './account';
import { ACCOUNTS_URL } from './accounts-server';
import { linkIn, newAddress } from './mail';

// The phone app's page in a phone's browser. Its account lives on the site's
// server, which it reaches from another origin with a token and no cookie,
// as the app does from inside a phone.

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
}

async function openAccount(page: Page): Promise<void> {
  await page.getByTestId('account').click();
  await expect(page.getByTestId('account-modal')).toBeVisible();
}

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
  const address = newAddress();
  await openApp(page);
  await openAccount(page);
  await page.getByTestId('account-to-sign-up').click();
  await fill(page, 'account-sign-up', { email: address, password: PASSWORD });
  await expect(page.getByTestId('account-check-inbox')).toContainText('come back here and log in');

  // The link is opened in the phone's browser, on the site. The app hears nothing of it.
  const browser = await context.newPage();
  await browser.goto(await linkIn(address, /Confirm/));
  await expect(browser.getByTestId('account-address')).toHaveText(address);
  await browser.close();
  await context.clearCookies();

  await page.getByTestId('account-to-log-in').click();
  await fill(page, 'account-log-in', { email: address, password: 'not the password' });
  await expect(page.getByTestId('account-problem')).toHaveText('Incorrect email or password.');
  await fill(page, 'account-log-in', { password: PASSWORD });
  await expect(page.getByTestId('account-address')).toHaveText(address);
  expect(await context.cookies()).toEqual([]);

  await page.getByTestId('beats-save').click();
  await expect(page.getByTestId('beats-said')).toContainText('to your account.');

  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await openAccount(page);
  await expect(page.getByTestId('account-address')).toHaveText(address);
  await expect(page.getByTestId('beats')).toContainText('Starter beat');

  await page.getByTestId('account-log-out').click();
  await expect(page.getByTestId('account-log-in')).toBeVisible();
  await fill(page, 'account-log-in', { email: address, password: PASSWORD });
  await expect(page.getByTestId('account-address')).toHaveText(address);

  await page.getByTestId('account-to-delete').click();
  await page.getByTestId('account-delete-form').getByTestId('account-password').fill(PASSWORD);
  await page.getByTestId('account-delete-form').getByTestId('account-submit').click();
  await expect(page.getByTestId('account-notice')).toHaveText('Your account and its saved beats are deleted.');
  await fill(page, 'account-log-in', { email: address, password: PASSWORD });
  await expect(page.getByTestId('account-problem')).toHaveText('Incorrect email or password.');
});

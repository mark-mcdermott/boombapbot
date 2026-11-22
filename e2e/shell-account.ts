import { expect, type BrowserContext, type Page } from '@playwright/test';
import { PASSWORD, fill } from './account';
import { linkIn, newAddress } from './mail';

// What the tests of an app's page share. Its account lives on the site's
// server, which it reaches from another origin with a token and no cookie,
// as the app does from inside a phone or a window on a desktop.

export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
}

export async function openAccount(page: Page): Promise<void> {
  await page.getByTestId('account').click();
  await expect(page.getByTestId('account-modal')).toBeVisible();
}

/** An account made, logged in to, kept across a restart, and deleted, with no cookie. */
export async function accountFromSignUpToDeletion(page: Page, context: BrowserContext): Promise<void> {
  const address = newAddress();
  await openApp(page);
  await openAccount(page);
  await page.getByTestId('account-to-sign-up').click();
  await fill(page, 'account-sign-up', { email: address, password: PASSWORD });
  await expect(page.getByTestId('account-check-inbox')).toContainText('come back here and log in');

  // The link is opened in the person's browser, on the site. The app hears nothing of it.
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

  await page.getByTestId('beats-save-name').fill('Pocket beat');
  await page.getByTestId('beats-save').click();
  await expect(page.getByTestId('beats-said')).toHaveText('Saved “Pocket beat” to your account.');

  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await openAccount(page);
  await expect(page.getByTestId('account-address')).toHaveText(address);
  await expect(page.getByTestId('beats')).toContainText('Pocket beat');

  // A new name goes by a method the site has to allow from another origin by name.
  const saved = page.getByTestId('beat').first();
  await saved.getByTestId('beat-edit').click();
  await saved.getByTestId('beat-rename-name').fill('Pocket beat, renamed');
  await saved.getByTestId('beat-rename-save').click();
  await expect(page.getByTestId('beats-said')).toHaveText('Renamed “Pocket beat” to “Pocket beat, renamed”.');

  // A delete has no body. The site refuses one from another origin unless it names a type all the same.
  await saved.getByTestId('beat-delete').click();
  await saved.getByTestId('beat-delete-confirm').click();
  await expect(page.getByTestId('beats-said')).toHaveText('Deleted “Pocket beat, renamed” from your account.');
  await expect(page.getByTestId('beat')).toHaveCount(0);

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
}

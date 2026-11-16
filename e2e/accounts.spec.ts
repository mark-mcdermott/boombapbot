import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ACCOUNTS_URL } from './accounts-server';
import { openEditor } from './helpers';
import { linkIn, mailTo, newAddress } from './mail';

// These run against the built server (see playwright.config.ts): a database
// in memory, and an outbox folder where it files the email it would send.

const PASSWORD = 'four on the floor';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function openAccount(page: Page): Promise<void> {
  await openEditor(page);
  await page.getByTestId('account').click();
  await expect(page.getByTestId('account-log-in')).toBeVisible();
}

async function fill(page: Page, form: string, values: { email?: string; password?: string }): Promise<void> {
  const fields = page.getByTestId(form);
  if (values.email !== undefined) await fields.getByTestId('account-email').fill(values.email);
  if (values.password !== undefined) await fields.getByTestId('account-password').fill(values.password);
  await fields.getByTestId('account-submit').click();
}

async function signUp(page: Page, address: string): Promise<void> {
  await openAccount(page);
  await page.getByTestId('account-to-sign-up').click();
  await fill(page, 'account-sign-up', { email: address, password: PASSWORD });
  await expect(page.getByTestId('account-check-inbox')).toContainText(address);
}

/** Opens the emailed link, which confirms the address and logs in. */
async function confirm(page: Page, address: string): Promise<void> {
  await page.goto(await linkIn(address, /Confirm/));
  await expect(page.getByTestId('account-address')).toHaveText(address);
}

async function logOut(page: Page): Promise<void> {
  await page.getByTestId('account-log-out').click();
  await expect(page.getByTestId('account-log-in')).toBeVisible();
}

test('signing up needs the address confirmed, and the emailed link logs you in', async ({ page }) => {
  const address = newAddress();
  await signUp(page, address);

  // Logging in before confirming leads back to the inbox, with a way to get the link again.
  await page.getByTestId('account-to-log-in').click();
  await fill(page, 'account-log-in', { email: address, password: PASSWORD });
  await expect(page.getByTestId('account-check-inbox')).toContainText(address);
  await page.getByTestId('account-resend').click();
  await expect(page.getByTestId('account-resent')).toHaveText('Sent again.');
  await expect.poll(() => mailTo(address, /Confirm/).length).toBe(2);

  // The email says what it is and how long the link lasts, and points at this site.
  const mail = mailTo(address, /Confirm/).at(-1)!;
  expect(mail.text).toContain('The link works for an hour.');
  expect(mail.text).toContain(`${ACCOUNTS_URL}/api/auth/verify-email?token=`);
  expect(mail.html).toContain('&amp;callbackURL=');
  expect(mail.html).not.toMatch(/\bwe\b/i);

  // The link logs in, opens the modal to say so, and leaves nothing in the address.
  await confirm(page, address);
  await expect(page.getByTestId('account-notice')).toHaveText('Your email is confirmed.');
  expect(new URL(page.url()).search).toBe('');
  await expect(page.getByTestId('editor')).toBeVisible();

  // Still logged in after a reload, and logged out when asked.
  await page.reload();
  await expect(page.getByTestId('account')).toHaveAccessibleName('Account, logged in');
  await page.getByTestId('account').click();
  await expect(page.getByTestId('account-address')).toHaveText(address);
  await logOut(page);
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('account')).toHaveAccessibleName('Account');
});

test('logging in takes the right password and says so plainly when it is wrong', async ({ page }) => {
  const address = newAddress();
  await signUp(page, address);
  await confirm(page, address);
  await logOut(page);

  await fill(page, 'account-log-in', { email: address, password: 'not the password' });
  await expect(page.getByTestId('account-problem')).toHaveText('That email and password do not match an account.');
  await expect(page.getByTestId('account-submit')).toBeEnabled();

  await fill(page, 'account-log-in', { password: PASSWORD });
  await expect(page.getByTestId('account-address')).toHaveText(address);
  await expect(page.getByTestId('account-notice')).toHaveCount(0);
});

test('a forgotten password is reset through an emailed link', async ({ page }) => {
  const address = newAddress();
  const changed = 'two and four, always';
  await signUp(page, address);
  await confirm(page, address);
  await logOut(page);

  await page.getByTestId('account-to-forgot').click();
  await fill(page, 'account-forgot', { email: address });
  await expect(page.getByTestId('account-reset-sent')).toContainText(address);

  // The link opens the modal on a new password, and its token leaves the address.
  await page.goto(await linkIn(address, /Reset/));
  await expect(page.getByTestId('account-new-password')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  await fill(page, 'account-new-password', { password: changed });
  await expect(page.getByTestId('account-notice')).toHaveText('Password changed. Log in with the new one.');

  await fill(page, 'account-log-in', { email: address, password: PASSWORD });
  await expect(page.getByTestId('account-problem')).toContainText('do not match');
  await fill(page, 'account-log-in', { password: changed });
  await expect(page.getByTestId('account-address')).toHaveText(address);
});

test('asking to reset an address with no account answers the same way', async ({ page }) => {
  const address = newAddress();
  await openAccount(page);
  await page.getByTestId('account-to-forgot').click();
  await fill(page, 'account-forgot', { email: address });
  await expect(page.getByTestId('account-reset-sent')).toContainText(`If ${address} has an account`);
});

test('a link that no longer works says so and offers the way forward', async ({ page }) => {
  // A reset link whose token the server does not know.
  await page.goto(`/api/auth/reset-password/not-a-token?callbackURL=${encodeURIComponent('/?account=reset')}`);
  await expect(page.getByTestId('account-notice')).toContainText('That reset link has expired or was already used');
  await expect(page.getByTestId('account-forgot')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');

  // A confirmation link that has expired.
  await page.goto('/?account=verified&error=token_expired');
  await expect(page.getByTestId('account-notice')).toContainText('That confirmation link has expired');
  await expect(page.getByTestId('account-log-in')).toBeVisible();
});

test('the account forms have no detectable accessibility violations', async ({ page }) => {
  await openAccount(page);
  const modal = page.getByTestId('account-modal');
  const scan = async () => {
    await expect.poll(() => modal.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
    return (await new AxeBuilder({ page }).analyze()).violations.map((violation) => violation.id);
  };
  expect(await scan()).toEqual([]);
  await fill(page, 'account-log-in', { email: newAddress(), password: 'nobody has this' });
  await expect(page.getByTestId('account-problem')).not.toBeEmpty();
  expect(await scan()).toEqual([]);
  await page.getByTestId('account-to-sign-up').click();
  await expect(page.getByTestId('account-sign-up')).toBeVisible();
  expect(await scan()).toEqual([]);
});

test.describe('what the server answers', () => {
  const post = (request: APIRequestContext, path: string, data: Record<string, string>) =>
    request.post(`/api/auth/${path}`, { data, headers: { origin: ACCOUNTS_URL } });

  /** Every key under which a row id could travel. */
  const ROW_ID = /"(id|userId|accountId)":\s*("\d+"|\d+\b|null)/;

  test('row ids never leave it: a record is known outside by its uuid', async ({ request }) => {
    const address = newAddress();
    const signedUp = await post(request, 'sign-up/email', { email: address, password: PASSWORD, name: '' });
    expect(signedUp.ok()).toBe(true);
    const created = await signedUp.json();
    expect(created.user.id).toMatch(UUID);
    expect(created.user).not.toHaveProperty('uuid');

    // The same address again is answered the same way, so it cannot be used to ask who has an account.
    const again = await (await post(request, 'sign-up/email', { email: address, password: PASSWORD, name: '' })).json();
    expect(Object.keys(again.user).sort()).toEqual(Object.keys(created.user).sort());
    expect(again.user.id).toMatch(UUID);

    await request.get(await linkIn(address, /Confirm/));
    for (const path of ['get-session', 'list-sessions', 'list-accounts']) {
      const answer = await request.get(`/api/auth/${path}`);
      expect(answer.ok(), path).toBe(true);
      expect(await answer.text(), path).not.toMatch(ROW_ID);
    }
    const { session, user } = await (await request.get('/api/auth/get-session')).json();
    expect(user.id).toBe(created.user.id);
    expect(user.email).toBe(address);
    expect(session.id).toMatch(UUID);
    expect(session).not.toHaveProperty('userId');
  });
});

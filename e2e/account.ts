import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { ACCOUNTS_URL } from './accounts-server';
import { openEditor } from './helpers';
import { linkIn, newAddress } from './mail';

// What the tests that need an account share. They run against the built
// server, where an address is confirmed through the outbox folder.

export const PASSWORD = 'four on the floor';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function openAccount(page: Page): Promise<void> {
  await openEditor(page);
  await page.getByTestId('account').click();
  await expect(page.getByTestId('account-log-in')).toBeVisible();
}

export async function fill(page: Page, form: string, values: { email?: string; password?: string }): Promise<void> {
  const fields = page.getByTestId(form);
  if (values.email !== undefined) await fields.getByTestId('account-email').fill(values.email);
  if (values.password !== undefined) await fields.getByTestId('account-password').fill(values.password);
  await fields.getByTestId('account-submit').click();
}

export async function signUp(page: Page, address: string): Promise<void> {
  await openAccount(page);
  await page.getByTestId('account-to-sign-up').click();
  await fill(page, 'account-sign-up', { email: address, password: PASSWORD });
  await expect(page.getByTestId('account-check-inbox')).toContainText(address);
}

/** Opens the emailed link, which confirms the address and logs in. */
export async function confirm(page: Page, address: string): Promise<void> {
  await page.goto(await linkIn(address, /Confirm/));
  await expect(page.getByTestId('account-address')).toHaveText(address);
}

export async function logOut(page: Page): Promise<void> {
  await page.getByTestId('account-log-out').click();
  await expect(page.getByTestId('account-log-in')).toBeVisible();
}

/** Every key under which a row id could travel. */
export const ROW_ID = /"(id|userId|accountId)":\s*("\d+"|\d+\b|null)/;

/** A new confirmed account, logged in on the page with the account modal open. */
export async function signedUp(page: Page): Promise<string> {
  const address = newAddress();
  await signUp(page, address);
  await confirm(page, address);
  return address;
}

/** A new confirmed account logged in on a bare request context, with no page. */
export async function signedUpRequest(request: APIRequestContext): Promise<string> {
  const address = newAddress();
  const signedUp = await request.post('/api/auth/sign-up/email', {
    data: { email: address, password: PASSWORD, name: '' },
    headers: { origin: ACCOUNTS_URL },
  });
  expect(signedUp.ok()).toBe(true);
  expect((await request.get(await linkIn(address, /Confirm/))).ok()).toBe(true);
  return address;
}

import { createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { PASSWORD, ROW_ID, UUID, signedUp, signedUpRequest } from './account';
import {
  ACCOUNTS_URL,
  BROKEN_MAIL_PORT,
  CLOSED_PORT,
  CLOSED_URL,
  FAKE_SERVICES_URL,
  LICENSE_SIGNING_KEY,
} from './accounts-server';
import { openEditor, scanner } from './helpers';
import { mailTo, newAddress } from './mail';
import { startServer, type SecondServer } from './second-server';
import { checkoutEvent } from './stripe';

// The one-time upgrade and its license key. Like the shop's tests these run
// against the built server with its database in memory, the outbox in place
// of email and a fake in place of Stripe. The first tests ask the server
// alone; the ones after them go through the upgrade's modal.

// One worker, in order: the fake remembers every checkout it was sent.
test.describe.configure({ mode: 'serial' });

const KEY = /BOOM(-[0-9A-HJKMNP-TV-Z]{5}){4}/;
const SUBJECT = /license key/;
const json = { origin: ACCOUNTS_URL, 'content-type': 'application/json' };

interface Checkout {
  id: string;
  form: Record<string, string>;
}

const checkouts = async (request: APIRequestContext) =>
  (await (await request.get(`${FAKE_SERVICES_URL}/calls/upgrade`)).json()) as Checkout[];

/** Starts a checkout for the upgrade and returns what Stripe was asked for. */
async function checkout(request: APIRequestContext): Promise<Checkout> {
  const answer = await request.post('/api/upgrade/checkout', { headers: json });
  expect(answer.status(), await answer.text()).toBe(200);
  expect(await answer.json()).toEqual({ url: `${ACCOUNTS_URL}/?upgrade=paid` });
  const asked = (await checkouts(request)).at(-1);
  expect(asked).toBeTruthy();
  return asked!;
}

/** What Stripe sends about that checkout, with the metadata the site gave it. */
function eventFor({ id, form }: Checkout, email: string, session: Record<string, unknown> = {}) {
  const account = form['metadata[account]'];
  return checkoutEvent({
    id,
    payment_status: 'paid',
    payment_intent: `pi_${id}`,
    amount_total: 500,
    customer_details: { email },
    metadata: { purpose: form['metadata[purpose]'], ...(account && { account }) },
    ...session,
  });
}

const paid = (request: APIRequestContext, event: ReturnType<typeof checkoutEvent>) =>
  request.post('/api/webhooks/stripe', event);

/** Every key emailed to an address, oldest first. */
const keysMailedTo = (address: string) => mailTo(address, SUBJECT).map((mail) => mail.text.match(KEY)?.[0]);

/** Buys the upgrade with nobody logged in, and returns the key that was emailed. */
async function boughtWithoutAccount(request: APIRequestContext, address = newAddress()): Promise<string> {
  const event = eventFor(await checkout(request), address);
  expect((await paid(request, event)).status()).toBe(200);
  const [key] = keysMailedTo(address);
  expect(key).toMatch(KEY);
  return key!;
}

const upgrade = async (request: APIRequestContext) => (await request.get('/api/upgrade')).json();
const redeem = (request: APIRequestContext, key: unknown) =>
  request.post('/api/upgrade/redeem', { data: { key }, headers: json });
const remind = (request: APIRequestContext, email: unknown) =>
  request.post('/api/upgrade/key', { data: { email }, headers: json });

const licenseFile = (request: APIRequestContext, key: unknown, headers: Record<string, string> = json) =>
  request.post('/api/upgrade/license', { data: { key }, headers });

/** The public half of the test server's signing key, worked out by Node from the 32 bytes the server was given. */
const LICENSE_VERIFYING_KEY = createPublicKey(
  createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(LICENSE_SIGNING_KEY, 'base64url')]),
    format: 'der',
    type: 'pkcs8',
  }),
);

/**
 * What a license file says, once Node's own Ed25519 has checked it the way
 * docs/license-file.md describes: the signature is over everything before
 * the last dot.
 */
async function licenseFileIn(answer: APIResponse): Promise<{ version: number; licenseId: string; issuedAt: string; unlocks: string[] }> {
  expect(answer.status(), await answer.text()).toBe(200);
  const text = await answer.text();
  expect(text).not.toMatch(ROW_ID);
  const body = JSON.parse(text);
  expect(Object.keys(body)).toEqual(['file']);
  const [prefix, payload, signature, ...more] = (body.file as string).split('.');
  expect(more).toEqual([]);
  expect(prefix).toBe('boombapbot-license');
  const signed = Buffer.from(`${prefix}.${payload}`);
  expect(verify(null, signed, LICENSE_VERIFYING_KEY, Buffer.from(signature!, 'base64url'))).toBe(true);
  return JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
}

async function refused(answer: APIResponse, status: number, code: string): Promise<void> {
  expect(answer.status(), await answer.text()).toBe(status);
  expect(await answer.json()).toMatchObject({ code, message: expect.stringMatching(/\S/) });
}

test('it costs five dollars, and nobody has it who has not bought it', async ({ request }) => {
  const closedToNobody = { open: true, priceCents: 500, currency: 'usd', upgraded: false };
  expect(await upgrade(request)).toEqual(closedToNobody);
  await refused(await request.get('/api/upgrade/key'), 401, 'signed_out');
  await refused(await redeem(request, 'BOOM-00000-00000-00000-00000'), 401, 'signed_out');

  await signedUpRequest(request);
  expect(await upgrade(request)).toEqual(closedToNobody);
  await refused(await request.get('/api/upgrade/key'), 404, 'no_license');
});

test('someone logged in pays once, and the key is on the account and in the email', async ({ request }) => {
  const address = await signedUpRequest(request);
  const asked = await checkout(request);
  expect(asked.form).toMatchObject({
    mode: 'payment',
    customer_email: address,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][unit_amount]': '500',
    'line_items[0][price_data][currency]': 'usd',
    'metadata[purpose]': 'upgrade',
    cancel_url: `${ACCOUNTS_URL}/?upgrade=open`,
  });
  // Stripe hears of the account by its uuid, never its row id.
  expect(asked.form['metadata[account]']).toMatch(UUID);
  expect(asked.form.client_reference_id).toBe(asked.form['metadata[account]']);

  // Starting a checkout gives nothing away.
  expect((await upgrade(request)).upgraded).toBe(false);
  expect(keysMailedTo(address)).toEqual([]);

  expect((await paid(request, eventFor(asked, address))).status()).toBe(200);
  expect((await upgrade(request)).upgraded).toBe(true);

  const held = await request.get('/api/upgrade/key');
  expect(held.status()).toBe(200);
  const text = await held.text();
  expect(text).not.toMatch(ROW_ID);
  const { license } = JSON.parse(text);
  expect(Object.keys(license).sort()).toEqual(['id', 'issuedAt', 'key']);
  expect(license.id).toMatch(UUID);
  expect(license.key).toMatch(new RegExp(`^${KEY.source}$`));
  expect(Number.isNaN(Date.parse(license.issuedAt))).toBe(false);

  const [mail, ...more] = mailTo(address, SUBJECT);
  expect(more).toEqual([]);
  expect(mail!.text).toContain(license.key);
  expect(mail!.html).toContain(license.key);

  // An account that has it is not sold it again.
  await refused(await request.post('/api/upgrade/checkout', { headers: json }), 409, 'already_upgraded');
});

test('one payment makes one key, however often Stripe says so and even twice at once', async ({ request }) => {
  const address = newAddress();
  const asked = await checkout(request);
  // Nobody is logged in, so Stripe asks for the address and is told of no account.
  expect(asked.form).not.toHaveProperty('customer_email');
  expect(asked.form).not.toHaveProperty('metadata[account]');
  expect(asked.form).not.toHaveProperty('client_reference_id');

  const event = eventFor(asked, address);
  const together = await Promise.all(Array.from({ length: 4 }, () => paid(request, event)));
  expect(together.map((answer) => answer.status())).toEqual([200, 200, 200, 200]);

  // Deliveries that crossed may each have sent the email, but never another key.
  const sent = keysMailedTo(address);
  expect(sent.length).toBeGreaterThan(0);
  expect(sent[0]).toMatch(KEY);
  expect(new Set(sent).size).toBe(1);

  // Told again later, there is nothing left to do.
  expect((await paid(request, event)).status()).toBe(200);
  expect((await paid(request, event)).status()).toBe(200);
  expect(keysMailedTo(address)).toEqual(sent);

  // The same for someone logged in, where the license also goes onto the account.
  const member = await signedUpRequest(request);
  const theirs = eventFor(await checkout(request), member);
  const crossed = await Promise.all(Array.from({ length: 4 }, () => paid(request, theirs)));
  expect(crossed.map((answer) => answer.status())).toEqual([200, 200, 200, 200]);
  const { key } = (await (await request.get('/api/upgrade/key')).json()).license;
  expect(new Set(keysMailedTo(member))).toEqual(new Set([key]));
});

test('only a checkout Stripe signed and was paid for makes a key', async ({ request }) => {
  const address = newAddress();
  const asked = await checkout(request);

  const event = eventFor(asked, address);
  const unsigned = await request.post('/api/webhooks/stripe', {
    data: event.data,
    headers: { 'content-type': 'application/json' },
  });
  expect(unsigned.status()).toBe(400);
  const forged = checkoutEvent(JSON.parse(event.data).data.object, 'someone-elses-secret');
  expect((await paid(request, forged)).status()).toBe(400);

  // A checkout that finished before the money arrived is heard and left alone.
  expect((await paid(request, eventFor(asked, address, { payment_status: 'unpaid' }))).status()).toBe(200);
  expect(keysMailedTo(address)).toEqual([]);

  // Then the money arrives.
  const later = checkoutEvent(JSON.parse(event.data).data.object, undefined, 'checkout.session.async_payment_succeeded');
  expect((await paid(request, later)).status()).toBe(200);
  expect(keysMailedTo(address)).toHaveLength(1);
});

test('a key bought without an account upgrades the one account it is entered in', async ({ request, playwright }) => {
  // Stripe hands the address over as it was typed; the key goes to it in lower case.
  const address = newAddress();
  const event = eventFor(await checkout(request), address.toUpperCase());
  expect((await paid(request, event)).status()).toBe(200);
  const [key] = keysMailedTo(address);
  expect(key).toMatch(KEY);

  await signedUpRequest(request);
  await refused(await redeem(request, 'not a key'), 404, 'unknown_key');
  await refused(await redeem(request, 'BOOM-00000-00000-00000-00000'), 404, 'unknown_key');
  await refused(await redeem(request, 12345), 400, 'invalid');
  await refused(await request.post('/api/upgrade/redeem', { data: 'not json', headers: json }), 400, 'invalid');
  expect((await upgrade(request)).upgraded).toBe(false);

  // Typed carelessly, it is still the key.
  const typed = ` ${key!.toLowerCase().replaceAll('-', ' ')} `;
  const entered = await redeem(request, typed);
  expect(entered.status(), await entered.text()).toBe(200);
  expect(await entered.json()).toEqual({ upgraded: true });
  expect((await upgrade(request)).upgraded).toBe(true);
  expect((await (await request.get('/api/upgrade/key')).json()).license.key).toBe(key);

  // Entering it again changes nothing, and a second key is not taken.
  expect((await redeem(request, key)).status()).toBe(200);
  const spare = await boughtWithoutAccount(await playwright.request.newContext({ baseURL: ACCOUNTS_URL }));
  await refused(await redeem(request, spare), 409, 'already_upgraded');

  // Somebody else cannot have the first key, and can have the second.
  const other = await playwright.request.newContext({ baseURL: ACCOUNTS_URL });
  await signedUpRequest(other);
  await refused(await redeem(other, key), 409, 'key_taken');
  expect((await upgrade(other)).upgraded).toBe(false);
  expect((await redeem(other, spare)).status()).toBe(200);
  expect((await (await other.get('/api/upgrade/key')).json()).license.key).toBe(spare);
  expect((await (await request.get('/api/upgrade/key')).json()).license.key).toBe(key);
});

test('paying twice from one account gives a second key that is on no account', async ({ request, playwright }) => {
  const address = await signedUpRequest(request);
  // Two checkouts are open before either is paid, as from two tabs.
  const first = await checkout(request);
  const second = await checkout(request);
  expect((await paid(request, eventFor(first, address))).status()).toBe(200);
  expect((await paid(request, eventFor(second, address))).status()).toBe(200);

  const keys = keysMailedTo(address);
  expect(keys).toHaveLength(2);
  expect(new Set(keys).size).toBe(2);
  expect((await (await request.get('/api/upgrade/key')).json()).license.key).toBe(keys[0]);

  const friend = await playwright.request.newContext({ baseURL: ACCOUNTS_URL });
  await signedUpRequest(friend);
  expect((await redeem(friend, keys[1])).status()).toBe(200);
});

test('the key is emailed again to the address that bought it, and only there', async ({ request }) => {
  const address = newAddress();
  const key = await boughtWithoutAccount(request, address);

  // An address that bought nothing is answered the same way and sent nothing.
  const stranger = newAddress();
  const unknown = await remind(request, stranger);
  expect(unknown.status()).toBe(202);
  expect(await unknown.json()).toEqual({ received: true });

  // This server runs with its limits off, so the key goes out again at once,
  // just after the answer.
  const asked = await remind(request, address.toUpperCase());
  expect(asked.status()).toBe(202);
  expect(await asked.json()).toEqual({ received: true });
  await expect.poll(() => keysMailedTo(address)).toEqual([key, key]);
  const reminder = mailTo(address, SUBJECT).at(-1)!;
  expect(reminder.html).toContain(key);
  expect(reminder.text).not.toBe(mailTo(address, SUBJECT)[0]!.text);
  expect(mailTo(stranger, /./)).toEqual([]);

  await refused(await remind(request, 'not an address'), 400, 'invalid');
  await refused(await remind(request, undefined), 400, 'invalid');
});

test('a deleted account leaves its license behind, and the key goes onto another', async ({ request, playwright }) => {
  const address = await signedUpRequest(request);
  expect((await paid(request, eventFor(await checkout(request), address))).status()).toBe(200);
  const { key } = (await (await request.get('/api/upgrade/key')).json()).license;

  const deleted = await request.post('/api/auth/delete-user', { data: { password: PASSWORD }, headers: json });
  expect(deleted.ok(), await deleted.text()).toBe(true);
  await refused(await request.get('/api/upgrade/key'), 401, 'signed_out');

  const next = await playwright.request.newContext({ baseURL: ACCOUNTS_URL });
  await signedUpRequest(next);
  expect((await redeem(next, key)).status()).toBe(200);
  expect((await upgrade(next)).upgraded).toBe(true);
});

test('an order from the shop is still an order, not a license', async ({ request }) => {
  const address = newAddress();
  // A paid checkout that does not say it is the upgrade is the shop's, and the
  // shop has no such order: Stripe is told to try again and nobody gets a key.
  const order = checkoutEvent({
    id: 'cs_test_shop',
    payment_status: 'paid',
    customer_details: { email: address },
    metadata: { order: crypto.randomUUID() },
  });
  expect((await paid(request, order)).status()).toBe(500);
  expect(mailTo(address, /./)).toEqual([]);
});

async function openUpgrade(page: Page): Promise<void> {
  await page.getByTestId('upgrade').click();
  await expect(page.getByTestId('upgrade-modal')).toBeVisible();
}

/** Presses the button that pays, and returns what Stripe was asked for once the buyer is back. */
async function buyInModal(page: Page, request: APIRequestContext): Promise<Checkout> {
  const before = (await checkouts(request)).length;
  await page.getByTestId('upgrade-buy').click();
  // The fake "takes the money" at once and sends the buyer where Stripe would.
  await expect(page.getByTestId('upgrade-thanks')).toContainText('Thank you');
  expect(new URL(page.url()).search).toBe('');
  const all = await checkouts(request);
  expect(all).toHaveLength(before + 1);
  return all.at(-1)!;
}

test('the modal sells it: the price, the way to Stripe and the way back', async ({ page, request }) => {
  const asked: string[] = [];
  page.on('request', (sent) => {
    if (new URL(sent.url()).pathname.startsWith('/api/upgrade')) asked.push(sent.method());
  });
  await openEditor(page);
  // Nothing about the upgrade is asked until somebody opens it.
  await expect(page.getByTestId('account')).toHaveAccessibleName('Account');
  expect(asked).toEqual([]);

  await openUpgrade(page);
  const modal = page.getByTestId('upgrade-modal');
  await expect(page.getByTestId('upgrade-price')).toHaveText('$5.00');
  await expect(page.getByTestId('upgrade-buy')).toHaveText('Pay $5.00 on Stripe');
  await expect.poll(() => modal.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  expect((await scanner(page).analyze()).violations.map((violation) => violation.id)).toEqual([]);

  // Nobody is logged in, so Stripe is told of no account and asks for the address itself.
  const checkout = await buyInModal(page, request);
  expect(checkout.form).toMatchObject({ 'metadata[purpose]': 'upgrade', success_url: `${ACCOUNTS_URL}/?upgrade=paid` });
  expect(checkout.form).not.toHaveProperty('customer_email');
  // Having just paid, nobody is offered it again, and the key's way onto an account is said.
  await expect(page.getByTestId('upgrade-buy')).toHaveCount(0);
  await expect(modal).toContainText('on its way');
  await expect(page.getByTestId('upgrade-log-in')).toBeVisible();

  // Closed and opened again, it is the offer as it was.
  await page.getByTestId('upgrade-close').click();
  await openUpgrade(page);
  await expect(page.getByTestId('upgrade-thanks')).toHaveCount(0);
  await expect(page.getByTestId('upgrade-buy')).toBeVisible();
});

test('coming back from Stripe without paying opens the offer again', async ({ page }) => {
  await page.goto('/?upgrade=open');
  await expect(page.getByTestId('upgrade-buy')).toBeVisible();
  await expect(page.getByTestId('upgrade-thanks')).toHaveCount(0);
  expect(new URL(page.url()).search).toBe('');
});

test('someone logged in buys it in the modal, and the key shows there once Stripe says so', async ({ page, request, context, browserName }) => {
  // Only Chromium lets a test read the clipboard back.
  const readsClipboard = browserName === 'chromium';
  if (readsClipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const address = await signedUp(page);
  await page.getByTestId('account-close').click();
  await openUpgrade(page);
  const checkout = await buyInModal(page, request);
  expect(checkout.form.customer_email).toBe(address);

  // Stripe has not said so yet: the modal waits, and does not sell it twice.
  await expect(page.getByTestId('upgrade-waiting')).toBeVisible();
  await expect(page.getByTestId('upgrade-buy')).toHaveCount(0);
  await expect(page.getByTestId('upgrade-key')).toHaveCount(0);

  // Then it does, and the key appears without anything being pressed.
  expect((await paid(request, eventFor(checkout, address))).status()).toBe(200);
  await expect(page.getByTestId('upgrade-key')).toHaveText(new RegExp(`^${KEY.source}$`));
  const key = await page.getByTestId('upgrade-key').innerText();
  expect(keysMailedTo(address)).toEqual([key]);
  await expect(page.getByTestId('upgrade-waiting')).toHaveCount(0);

  await page.getByTestId('upgrade-copy').click();
  await expect(page.getByTestId('upgrade-copied')).toHaveText('Copied.');
  if (readsClipboard) expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);
  const modal = page.getByTestId('upgrade-modal');
  expect((await scanner(page).analyze()).violations.map((violation) => violation.id)).toEqual([]);

  // It is still there on another visit, with nothing to buy and nothing to thank.
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await openUpgrade(page);
  await expect(page.getByTestId('upgrade-key')).toHaveText(key);
  await expect(page.getByTestId('upgrade-thanks')).toHaveCount(0);
  await expect(modal.locator('input')).toHaveCount(0);
  await expect(page.getByTestId('upgrade-buy')).toHaveCount(0);
});

test('a key bought without an account goes onto an account in the modal, for somebody who logs in', async ({ page, request }) => {
  const key = await boughtWithoutAccount(request);

  // With nobody logged in a key unlocks the browser alone, and the modal leads to an account for one that should go onto it.
  await openEditor(page);
  await openUpgrade(page);
  await page.getByTestId('upgrade-to-key').click();
  await expect(page.getByTestId('upgrade-key-form')).toContainText('It needs no account.');
  await page.getByTestId('upgrade-log-in').click();
  await expect(page.getByTestId('upgrade-modal')).toHaveCount(0);
  await expect(page.getByTestId('account-log-in')).toBeVisible();

  await signedUp(page);
  await page.getByTestId('account-close').click();
  await openUpgrade(page);
  await page.getByTestId('upgrade-to-key').click();
  const form = page.getByTestId('upgrade-key-form');

  await form.getByTestId('upgrade-key-input').fill('BOOM-00000-00000-00000-00000');
  await form.getByTestId('upgrade-submit').click();
  await expect(page.getByTestId('upgrade-problem')).toHaveText('That is not a license key I know.');
  await expect(form.getByTestId('upgrade-submit')).toBeEnabled();

  // Typed carelessly, it is still the key.
  await form.getByTestId('upgrade-key-input').fill(` ${key.toLowerCase().replaceAll('-', ' ')} `);
  await form.getByTestId('upgrade-submit').click();
  await expect(page.getByTestId('upgrade-key')).toHaveText(key);
  await expect(page.getByTestId('upgrade-notice')).toHaveText('That key is on this account now.');
  expect((await upgrade(page.request)).upgraded).toBe(true);

  // Closed and opened again, the key is still there and the notice has gone.
  await page.getByTestId('upgrade-close').click();
  await openUpgrade(page);
  await expect(page.getByTestId('upgrade-notice')).toHaveCount(0);
  await expect(page.getByTestId('upgrade-key')).toHaveText(key);
});

test('an upgraded account brings its license file to the browser, which trusts only the key built into it', async ({ page, request }) => {
  const key = await boughtWithoutAccount(request);
  const fetched = () =>
    page.waitForResponse((answer) => new URL(answer.url()).pathname === '/api/upgrade/license' && answer.request().method() === 'GET');
  const kept = () => page.evaluate(() => localStorage.getItem('boombapbot.license.v1'));

  // Logged in and not upgraded, the browser asks and is told there is none.
  await openEditor(page);
  const [none] = await Promise.all([fetched(), signedUp(page)]);
  expect(none.status()).toBe(404);
  await page.getByTestId('account-close').click();

  // The key goes onto the account, and the file is fetched without being asked for.
  await openUpgrade(page);
  await page.getByTestId('upgrade-to-key').click();
  await page.getByTestId('upgrade-key-input').fill(key);
  const [afterKey] = await Promise.all([fetched(), page.getByTestId('upgrade-submit').click()]);
  expect(afterKey.status()).toBe(200);
  expect((await afterKey.json()).file).toMatch(/^boombapbot-license\./);
  await expect(page.getByTestId('upgrade-key')).toHaveText(key);

  // This server signs with a key made for the run, not the one the page was
  // built with, so its file is a forgery to the page: not kept, and nothing unlocked.
  expect(await kept()).toBeNull();
  await expect(page.getByTestId('upgrade-on-device')).toHaveCount(0);

  // The page asks again when it next finds the account logged in.
  const [onLoad] = await Promise.all([fetched(), page.reload()]);
  expect(onLoad.status()).toBe(200);
  expect(await kept()).toBeNull();
});

test('a key alone is asked about with nobody logged in, and its file unlocks nothing unless the page\u2019s own key signed it', async ({ page, request }) => {
  const key = await boughtWithoutAccount(request);
  await openEditor(page);
  await openUpgrade(page);
  await page.getByTestId('upgrade-to-key').click();
  const form = page.getByTestId('upgrade-key-form');

  await form.getByTestId('upgrade-key-input').fill('BOOM-00000-00000-00000-00000');
  await form.getByTestId('upgrade-submit').click();
  await expect(page.getByTestId('upgrade-problem')).toHaveText('That is not a license key I know.');

  // The key is real and the server gives its file. This server signs with a
  // key made for the run, so the page takes the file for a forgery.
  const answered = page.waitForResponse((answer) => new URL(answer.url()).pathname === '/api/upgrade/license');
  await form.getByTestId('upgrade-key-input').fill(key);
  await form.getByTestId('upgrade-submit').click();
  const answer = await answered;
  expect(answer.request().method()).toBe('POST');
  expect(answer.status()).toBe(200);
  await expect(page.getByTestId('upgrade-problem')).toContainText('a license file this program does not accept');
  await expect(page.getByTestId('upgrade-key-on-device')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((name) => name.includes('license')))).toEqual([]);
  // The key is still on no account.
  await signedUp(page);
  expect((await upgrade(page.request)).upgraded).toBe(false);
});

test('a lost key is asked for in the modal and emailed to the address that bought it', async ({ page, request }) => {
  const address = newAddress();
  const key = await boughtWithoutAccount(request, address);

  await openEditor(page);
  await openUpgrade(page);
  await page.getByTestId('upgrade-to-lost').click();
  const form = page.getByTestId('upgrade-lost-form');
  await form.getByTestId('upgrade-email').fill(address);
  await form.getByTestId('upgrade-submit').click();
  // The answer names the address and does not say whether it bought anything.
  await expect(page.getByTestId('upgrade-key-sent')).toContainText(`If ${address} bought the upgrade`);
  await expect.poll(() => keysMailedTo(address)).toEqual([key, key]);

  await page.getByTestId('upgrade-back').click();
  await expect(page.getByTestId('upgrade-buy')).toBeVisible();
});

test('a key alone gets a signed license file, with nobody logged in', async ({ request }) => {
  const key = await boughtWithoutAccount(request);
  const before = Date.now();
  const file = await licenseFileIn(await licenseFile(request, key));
  expect(Object.keys(file).sort()).toEqual(['issuedAt', 'licenseId', 'unlocks', 'version']);
  expect(file).toMatchObject({ version: 1, unlocks: ['upgrade'] });
  expect(file.licenseId).toMatch(UUID);
  expect(Date.parse(file.issuedAt)).toBeGreaterThanOrEqual(before);

  // Typed any way a key is read, and as often as there are devices.
  const again = await licenseFileIn(await licenseFile(request, key.toLowerCase().replace(/-/g, ' ')));
  expect(again.licenseId).toBe(file.licenseId);

  await refused(await licenseFile(request, 'BOOM-00000-00000-00000-00000'), 404, 'unknown_key');
  await refused(await licenseFile(request, 'not a key'), 404, 'unknown_key');
  await refused(await licenseFile(request, 7), 400, 'invalid');
  await refused(await request.post('/api/upgrade/license', { data: 'key', headers: json }), 400, 'invalid');
  await refused(await request.get('/api/upgrade/license'), 401, 'signed_out');
});

test('an upgraded account gets its license file by logging in, and no other account does', async ({ request }) => {
  const key = await boughtWithoutAccount(request);
  await signedUpRequest(request);
  await refused(await request.get('/api/upgrade/license'), 404, 'no_license');

  expect((await redeem(request, key)).status()).toBe(200);
  const { license } = await (await request.get('/api/upgrade/key')).json();
  const file = await licenseFileIn(await request.get('/api/upgrade/license'));
  expect(file).toMatchObject({ version: 1, licenseId: license.id, unlocks: ['upgrade'] });

  // The key still gets the same license's file with nobody logged in.
  expect((await licenseFileIn(await licenseFile(request, key))).licenseId).toBe(license.id);
});

test.describe('until the upgrade is switched on', () => {
  // The server as the live site runs until UPGRADE_OPEN is set, with its
  // limits on. It has a database of its own and shares the outbox.
  let server: SecondServer;
  let closed: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    server = await startServer(playwright, CLOSED_PORT);
    closed = server.request;
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  const closedJson = { origin: CLOSED_URL, 'content-type': 'application/json' };

  test('nothing is sold', async () => {
    const before = (await checkouts(closed)).length;
    expect(await upgrade(closed)).toEqual({ open: false, priceCents: 500, currency: 'usd', upgraded: false });
    await refused(await closed.post('/api/upgrade/checkout', { headers: closedJson }), 503, 'closed');
    expect(await checkouts(closed)).toHaveLength(before);
  });

  test('the modal says it is not open and offers nothing to press, even to someone sent back from Stripe', async ({ browser }) => {
    const page = await browser.newPage({ baseURL: CLOSED_URL });
    for (const address of ['/', '/?upgrade=open']) {
      await page.goto(address);
      await expect(page.getByTestId('editor')).toBeVisible();
      if (address === '/') await openUpgrade(page);
      const modal = page.getByTestId('upgrade-modal');
      await expect(page.getByTestId('upgrade-closed')).toContainText('not open yet');
      await expect(modal.locator('input, button:not([data-testid="upgrade-close"])')).toHaveCount(0);
    }
    await page.close();
  });

  test('a payment already made is still honoured, and its key is not sent twice in ten minutes', async () => {
    const address = newAddress();
    const event = eventFor({ id: `cs_test_${crypto.randomUUID()}`, form: { 'metadata[purpose]': 'upgrade' } }, address);
    expect((await paid(closed, event)).status()).toBe(200);
    const sent = keysMailedTo(address);
    expect(sent).toHaveLength(1);

    for (let asked = 0; asked < 3; asked += 1) {
      const answer = await closed.post('/api/upgrade/key', { data: { email: address }, headers: closedJson });
      expect(answer.status()).toBe(202);
    }
    expect(keysMailedTo(address)).toEqual(sent);
  });

  /** Asks for the keys of `email` from a request that reached the site from `place`. */
  const remindFrom = (place: string, email: string) =>
    closed.post('/api/upgrade/key', { data: { email }, headers: { ...closedJson, 'x-forwarded-for': place } });

  test('one address can ask for its key three times an hour, from anywhere', async () => {
    const address = newAddress();
    const places = ['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4'];
    const answers = [];
    for (const place of places) answers.push(await remindFrom(place, address));
    expect(answers.map((answer) => answer.status())).toEqual([202, 202, 202, 429]);
    expect(await answers.at(-1)!.json()).toEqual({
      code: 'too_many',
      message: 'I have had that request a lot just now. Try again in an hour.',
    });
    expect((await remindFrom('198.51.100.5', newAddress())).status()).toBe(202);
  });

  test('one place can try ten keys for a license file in ten minutes, and then no more', async () => {
    const tryFrom = (place: string, key: string) => licenseFile(closed, key, { ...closedJson, 'x-forwarded-for': place });
    const guess = (last: number) => `BOOM-00000-00000-00000-0000${last}`;
    const statuses = [];
    for (let tried = 0; tried < 11; tried += 1) statuses.push((await tryFrom('198.51.100.40', guess(tried % 10))).status());
    expect(statuses).toEqual([...Array<number>(10).fill(404), 429]);
    await refused(await tryFrom('198.51.100.40', guess(0)), 429, 'too_many');
    await refused(await tryFrom('198.51.100.41', guess(0)), 404, 'unknown_key');
  });

  test('one place can ask for five addresses in ten minutes, and then no more', async () => {
    const statuses = [];
    for (let asked = 0; asked < 6; asked += 1) statuses.push((await remindFrom('198.51.100.20', newAddress())).status());
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
    expect((await remindFrom('198.51.100.21', newAddress())).status()).toBe(202);
  });
});

test.describe('the key by email, whether or not the address bought anything', () => {
  // A server whose outbox is a file, not a folder, so no email it tries can
  // be sent. If the answer waited for the send, a buyer would be answered
  // with an error and a stranger would not.
  const brokenUrl = `http://127.0.0.1:${BROKEN_MAIL_PORT}`;
  const brokenJson = { origin: brokenUrl, 'content-type': 'application/json' };
  let server: SecondServer;

  test.beforeAll(async ({ playwright }) => {
    server = await startServer(playwright, BROKEN_MAIL_PORT, { EMAIL_OUTBOX: 'package.json' });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test('is answered the same, even when the email cannot be sent', async () => {
    const buyer = newAddress();
    const event = eventFor({ id: `cs_test_${crypto.randomUUID()}`, form: { 'metadata[purpose]': 'upgrade' } }, buyer);
    // The license is recorded, and the key's email fails, so Stripe would be asked to try again.
    expect((await paid(server.request, event)).status()).toBe(500);

    const answer = async (email: string) => {
      const response = await server.request.post('/api/upgrade/key', { data: { email }, headers: brokenJson });
      const { date: _date, ...headers } = response.headers();
      return { status: response.status(), headers, body: await response.text() };
    };
    const forBuyer = await answer(buyer);
    const forStranger = await answer(newAddress());
    expect(forBuyer).toEqual(forStranger);
    expect(forBuyer.status).toBe(202);
    expect(JSON.parse(forBuyer.body)).toEqual({ received: true });
  });
});

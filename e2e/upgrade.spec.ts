import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { PASSWORD, ROW_ID, UUID, signedUpRequest } from './account';
import { ACCOUNTS_URL, CLOSED_PORT, CLOSED_URL, FAKE_SERVICES_URL, serverEnv } from './accounts-server';
import { mailTo, newAddress } from './mail';
import { checkoutEvent } from './stripe';

// The one-time upgrade and its license key. Like the shop's tests these run
// against the built server with its database in memory, the outbox in place
// of email and a fake in place of Stripe. Nothing here is a page: the
// upgrade's modal is not built yet, so everything is asked of the server.

// One worker, in order: the fake remembers every checkout it was sent.
test.describe.configure({ mode: 'serial' });

const KEY = /BOOM(-[0-9A-HJKMNP-TV-Z]{5}){4}/;
const SUBJECT = /license key/;
const json = { origin: ACCOUNTS_URL, 'content-type': 'application/json' };

interface Checkout {
  id: string;
  form: Record<string, string>;
}

/** Starts a checkout for the upgrade and returns what Stripe was asked for. */
async function checkout(request: APIRequestContext): Promise<Checkout> {
  const answer = await request.post('/api/upgrade/checkout', { headers: json });
  expect(answer.status(), await answer.text()).toBe(200);
  expect(await answer.json()).toEqual({ url: `${ACCOUNTS_URL}/?upgrade=paid` });
  const asked = ((await (await request.get(`${FAKE_SERVICES_URL}/calls/upgrade`)).json()) as Checkout[]).at(-1);
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

  // This server runs with its limits off, so the key goes out again at once.
  const asked = await remind(request, address.toUpperCase());
  expect(asked.status()).toBe(202);
  expect(await asked.json()).toEqual({ received: true });
  expect(keysMailedTo(address)).toEqual([key, key]);
  const reminder = mailTo(address, SUBJECT).at(-1)!;
  expect(reminder.html).toContain(key);
  expect(reminder.text).not.toBe(mailTo(address, SUBJECT)[0]!.text);

  // An address that bought nothing is answered the same way and sent nothing.
  const stranger = newAddress();
  const unknown = await remind(request, stranger);
  expect(unknown.status()).toBe(202);
  expect(await unknown.json()).toEqual({ received: true });
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

test.describe('until the upgrade is switched on', () => {
  // The server as the live site runs until UPGRADE_OPEN is set, with its
  // limits on. It has a database of its own and shares the outbox.
  let server: ChildProcess;
  let closed: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    // Started with those settings and nothing else, so no switch set in a shell reaches it.
    server = spawn(process.execPath, ['apps/site/dist/server/entry.mjs'], {
      env: serverEnv(CLOSED_PORT),
      stdio: 'ignore',
    });
    closed = await playwright.request.newContext({ baseURL: CLOSED_URL });
    await expect
      .poll(async () => (await closed.get('/api/upgrade').catch(() => null))?.status() ?? 0, { timeout: 20_000 })
      .toBe(200);
  });

  test.afterAll(async () => {
    await closed?.dispose();
    server?.kill();
  });

  const closedJson = { origin: CLOSED_URL, 'content-type': 'application/json' };

  const checkouts = async () => ((await (await closed.get(`${FAKE_SERVICES_URL}/calls/upgrade`)).json()) as Checkout[]).length;

  test('nothing is sold', async () => {
    const before = await checkouts();
    expect(await upgrade(closed)).toEqual({ open: false, priceCents: 500, currency: 'usd', upgraded: false });
    await refused(await closed.post('/api/upgrade/checkout', { headers: closedJson }), 503, 'closed');
    expect(await checkouts()).toBe(before);
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
});

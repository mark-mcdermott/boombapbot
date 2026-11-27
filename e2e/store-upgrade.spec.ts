import { expect, test, type APIRequestContext } from '@playwright/test';
import { UUID, signedUpRequest } from './account';
import { ACCOUNTS_URL, NO_STORE_PORT } from './accounts-server';
import {
  UPGRADE_PRODUCT,
  forgedTransaction,
  newPurchaseId,
  signedNotice,
  signedTransaction,
  type Purchase,
} from './app-store';
import { licenseFileIn, refused } from './license';
import { startServer } from './second-server';

// The upgrade bought in a store app. The app hands the server what the App
// Store signed, and the server makes the license a Stripe payment makes.
// These run against the built server, which trusts a root the tests made in
// place of Apple's, so every signature here is checked as a real one is.

const json = { origin: ACCOUNTS_URL, 'content-type': 'application/json' };

const show = (request: APIRequestContext, transaction: unknown, store: unknown = 'apple') =>
  request.post('/api/upgrade/store', { data: { store, transaction }, headers: json });
const bought = (request: APIRequestContext, purchase: Purchase) => show(request, signedTransaction(purchase));
const notice = (request: APIRequestContext, body: unknown) =>
  request.post('/api/webhooks/apple', { data: body, headers: { 'content-type': 'application/json' } });
const upgraded = async (request: APIRequestContext) => (await (await request.get('/api/upgrade')).json()).upgraded;

test('a purchase with nobody logged in gives a license file, and the same one when it is restored', async ({ request }) => {
  const purchase = { originalTransactionId: newPurchaseId() };
  const first = await licenseFileIn(await bought(request, purchase));
  expect(first.licenseId).toMatch(UUID);
  expect(first.unlocks).toEqual(['upgrade']);

  const restored = await licenseFileIn(await bought(request, purchase));
  expect(restored.licenseId).toBe(first.licenseId);

  const another = await licenseFileIn(await bought(request, { originalTransactionId: newPurchaseId() }));
  expect(another.licenseId).not.toBe(first.licenseId);
});

test('a purchase shown at once from two phones makes one license', async ({ request }) => {
  const purchase = { originalTransactionId: newPurchaseId() };
  const files = await Promise.all(Array.from({ length: 4 }, async () => licenseFileIn(await bought(request, purchase))));
  expect(new Set(files.map((file) => file.licenseId)).size).toBe(1);
});

test('a purchase made logged in goes onto the account, with a key and no email', async ({ request }) => {
  await signedUpRequest(request);
  expect(await upgraded(request)).toBe(false);
  const file = await licenseFileIn(await bought(request, { originalTransactionId: newPurchaseId() }));
  expect(await upgraded(request)).toBe(true);

  const { license } = await (await request.get('/api/upgrade/key')).json();
  expect(license.id).toBe(file.licenseId);
  expect((await licenseFileIn(await request.get('/api/upgrade/license'))).licenseId).toBe(file.licenseId);
});

test('a purchase made logged out goes onto the account its buyer logs in to next', async ({ request, playwright }) => {
  const purchase = { originalTransactionId: newPurchaseId() };
  const phone = await playwright.request.newContext({ baseURL: ACCOUNTS_URL });
  const file = await licenseFileIn(await bought(phone, purchase));

  await signedUpRequest(request);
  expect(await upgraded(request)).toBe(false);
  expect((await licenseFileIn(await bought(request, purchase))).licenseId).toBe(file.licenseId);
  expect(await upgraded(request)).toBe(true);

  // It is on one account. Somebody else showing it is given its file and nothing more.
  const other = await playwright.request.newContext({ baseURL: ACCOUNTS_URL });
  await signedUpRequest(other);
  await licenseFileIn(await bought(other, purchase));
  expect(await upgraded(other)).toBe(false);
  await Promise.all([phone.dispose(), other.dispose()]);
});

test('an account that has a license keeps it, and a second purchase stays on no account', async ({ request }) => {
  await signedUpRequest(request);
  const held = await licenseFileIn(await bought(request, { originalTransactionId: newPurchaseId() }));
  const second = await licenseFileIn(await bought(request, { originalTransactionId: newPurchaseId() }));
  expect(second.licenseId).not.toBe(held.licenseId);
  expect((await (await request.get('/api/upgrade/key')).json()).license.id).toBe(held.licenseId);
});

test('a purchase in the sandbox counts, and one Xcode signed for itself does not', async ({ request }) => {
  await licenseFileIn(await bought(request, { originalTransactionId: newPurchaseId(), environment: 'Sandbox' }));
  await refused(await bought(request, { originalTransactionId: newPurchaseId(), environment: 'Xcode' }), 400, 'not_a_purchase');
});

test('what the App Store did not sign for the upgrade in this app is refused', async ({ request }) => {
  const id = newPurchaseId();
  await refused(await show(request, forgedTransaction({ originalTransactionId: id })), 400, 'not_a_purchase');
  await refused(await bought(request, { originalTransactionId: id, productId: `${UPGRADE_PRODUCT}.other` }), 400, 'not_a_purchase');
  await refused(await bought(request, { originalTransactionId: id, bundleId: 'com.example.other' }), 400, 'not_a_purchase');

  const [header, payload, signature] = signedTransaction({ originalTransactionId: id }).split('.');
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), productId: UPGRADE_PRODUCT, originalTransactionId: newPurchaseId() })).toString('base64url');
  await refused(await show(request, `${header}.${changed}.${signature}`), 400, 'not_a_purchase');
  await refused(await show(request, 'not.a.signature'), 400, 'not_a_purchase');

  for (const [store, transaction] of [['apple', ''], ['apple', 7], ['google', 'x'], [null, 'x']] as const) {
    await refused(await show(request, transaction, store), 400, 'invalid');
  }
  // None of it made a license: the real purchase is still new.
  await licenseFileIn(await bought(request, { originalTransactionId: id }));
});

test('a refund at the App Store withdraws the license, and a refund undone gives it back', async ({ request }) => {
  await signedUpRequest(request);
  const purchase = { originalTransactionId: newPurchaseId() };
  const file = await licenseFileIn(await bought(request, purchase));

  // A notice about something else, or about somebody else's purchase, takes nothing away.
  expect((await notice(request, signedNotice('TEST', purchase))).status()).toBe(200);
  expect((await notice(request, signedNotice('REFUND', { originalTransactionId: newPurchaseId() }))).status()).toBe(200);
  expect(await upgraded(request)).toBe(true);

  for (let said = 0; said < 2; said += 1) expect((await notice(request, signedNotice('REFUND', purchase))).status()).toBe(200);
  expect(await upgraded(request)).toBe(false);
  await refused(await bought(request, purchase), 403, 'withdrawn');
  await refused(await request.get('/api/upgrade/license'), 404, 'no_license');

  expect((await notice(request, signedNotice('REFUND_REVERSED', purchase))).status()).toBe(200);
  expect((await licenseFileIn(await bought(request, purchase))).licenseId).toBe(file.licenseId);
  expect(await upgraded(request)).toBe(true);
});

test('a purchase the App Store has taken back gives no license, new or old', async ({ request }) => {
  const taken = { originalTransactionId: newPurchaseId(), revocationDate: Date.now() };
  await refused(await bought(request, taken), 403, 'withdrawn');

  const purchase = { originalTransactionId: newPurchaseId() };
  await licenseFileIn(await bought(request, purchase));
  await refused(await bought(request, { ...purchase, revocationDate: Date.now() }), 403, 'withdrawn');
  await refused(await bought(request, purchase), 403, 'withdrawn');
});

test('a notice the App Store did not sign withdraws nothing', async ({ request }) => {
  const purchase = { originalTransactionId: newPurchaseId() };
  await licenseFileIn(await bought(request, purchase));
  expect((await notice(request, signedNotice('REFUND', purchase, true))).status()).toBe(400);
  expect((await notice(request, { signedPayload: 'not.a.signature' })).status()).toBe(400);
  expect((await notice(request, {})).status()).toBe(400);
  await licenseFileIn(await bought(request, purchase));
});

test('a server with no app to sell checks no purchase and hears no notice', async ({ playwright }) => {
  const server = await startServer(playwright, NO_STORE_PORT, { APPLE_APP_ID: '' });
  try {
    const purchase = { originalTransactionId: newPurchaseId() };
    await refused(await bought(server.request, purchase), 503, 'no_store');
    expect((await notice(server.request, signedNotice('REFUND', purchase))).status()).toBe(503);
  } finally {
    await server.stop();
  }
});

import { expect, test, type APIRequestContext } from '@playwright/test';
import { UUID, signedUpRequest } from './account';
import { ACCOUNTS_URL, GOOGLE_PLAY_WEBHOOK_SECRET, NO_PLAY_PORT } from './accounts-server';
import {
  UPGRADE_PRODUCT,
  acknowledged,
  failNextAcknowledgement,
  newPurchaseToken,
  playKnows,
  productNotice,
  pushed,
  voided,
} from './google-play';
import { licenseFileIn, refused } from './license';
import { startServer } from './second-server';

// The upgrade bought in the Android app. The app hands the server the token
// Google Play gave it, and the server asks Google what that token bought.
// These run against the built server with a fake in Google's place, which
// the server reaches as a service account the tests made up.

const json = { origin: ACCOUNTS_URL, 'content-type': 'application/json' };

const show = (request: APIRequestContext, token: unknown) =>
  request.post('/api/upgrade/store', { data: { store: 'google', token }, headers: json });
const notice = (request: APIRequestContext, body: unknown, secret: string | null = GOOGLE_PLAY_WEBHOOK_SECRET) =>
  request.post(`/api/webhooks/google${secret === null ? '' : `?secret=${secret}`}`, { data: body, headers: { 'content-type': 'application/json' } });
const upgraded = async (request: APIRequestContext) => (await (await request.get('/api/upgrade')).json()).upgraded;

/** A token Play knows as a purchase of the upgrade. */
async function boughtToken(request: APIRequestContext): Promise<string> {
  const token = newPurchaseToken();
  await playKnows(request, token);
  return token;
}

test('a purchase gives a license file, is acknowledged at Google, and gives the same file when restored', async ({ request }) => {
  const token = await boughtToken(request);
  expect(await acknowledged(request, token)).toBe(false);
  const first = await licenseFileIn(await show(request, token));
  expect(first.licenseId).toMatch(UUID);
  expect(first.unlocks).toEqual(['upgrade']);
  expect(await acknowledged(request, token)).toBe(true);

  expect((await licenseFileIn(await show(request, token))).licenseId).toBe(first.licenseId);
  expect((await licenseFileIn(await show(request, await boughtToken(request)))).licenseId).not.toBe(first.licenseId);
});

test('a purchase shown at once from two phones makes one license', async ({ request }) => {
  const token = await boughtToken(request);
  const files = await Promise.all(Array.from({ length: 4 }, async () => licenseFileIn(await show(request, token))));
  expect(new Set(files.map((file) => file.licenseId)).size).toBe(1);
});

test('a purchase Google would not hear acknowledged is acknowledged the next time it is shown', async ({ request }) => {
  const token = await boughtToken(request);
  await failNextAcknowledgement(request, token);
  expect((await show(request, token)).status()).toBe(500);
  expect(await acknowledged(request, token)).toBe(false);

  await licenseFileIn(await show(request, token));
  expect(await acknowledged(request, token)).toBe(true);
});

test('a purchase made logged in goes onto the account, and one made logged out onto the account logged in to next', async ({ request, playwright }) => {
  const phone = await playwright.request.newContext({ baseURL: ACCOUNTS_URL });
  const loggedOut = await boughtToken(request);
  const file = await licenseFileIn(await show(phone, loggedOut));

  await signedUpRequest(request);
  expect(await upgraded(request)).toBe(false);
  expect((await licenseFileIn(await show(request, loggedOut))).licenseId).toBe(file.licenseId);
  expect(await upgraded(request)).toBe(true);
  expect((await (await request.get('/api/upgrade/key')).json()).license.id).toBe(file.licenseId);

  const other = await playwright.request.newContext({ baseURL: ACCOUNTS_URL });
  await signedUpRequest(other);
  await licenseFileIn(await show(other, loggedOut));
  expect(await upgraded(other)).toBe(false);
  await licenseFileIn(await show(other, await boughtToken(request)));
  expect(await upgraded(other)).toBe(true);
  await Promise.all([phone.dispose(), other.dispose()]);
});

test("a license tester's purchase counts", async ({ request }) => {
  const token = newPurchaseToken();
  await playKnows(request, token, { purchaseType: 0 });
  await licenseFileIn(await show(request, token));
});

test('what Google does not know as a paid purchase of the upgrade in this app is refused', async ({ request }) => {
  await refused(await show(request, newPurchaseToken()), 400, 'not_a_purchase');

  const token = newPurchaseToken();
  await playKnows(request, token, { product: `${UPGRADE_PRODUCT}.other` });
  await refused(await show(request, token), 400, 'not_a_purchase');
  await playKnows(request, token, { app: 'com.example.other' });
  await refused(await show(request, token), 400, 'not_a_purchase');
  await playKnows(request, token, { purchaseState: 2 });
  await refused(await show(request, token), 400, 'not_a_purchase');
  expect(await acknowledged(request, token)).toBe(false);

  for (const sent of ['', 7, null, 'x'.repeat(5000)]) await refused(await show(request, sent), 400, 'invalid');
  await refused(await request.post('/api/upgrade/store', { data: { store: 'google', transaction: token }, headers: json }), 400, 'invalid');

  // None of it made a license: once it is paid for, the purchase is still new.
  await playKnows(request, token);
  await licenseFileIn(await show(request, token));
});

test("a refund at Google Play withdraws the license, whichever of Google's notices says so", async ({ playwright }) => {
  for (const refundNotice of [voided, (token: string) => productNotice(token, 2)]) {
    const request = await playwright.request.newContext({ baseURL: ACCOUNTS_URL });
    await signedUpRequest(request);
    const token = await boughtToken(request);
    await licenseFileIn(await show(request, token));

    // A notice about something else, another app or somebody else's purchase takes nothing away.
    for (const other of [
      pushed({ testNotification: { version: '1.0' } }),
      productNotice(token, 1),
      productNotice(token, 2, `${UPGRADE_PRODUCT}.other`),
      voided(token, 2),
      voided(token, 1, 1),
      pushed({ voidedPurchaseNotification: { purchaseToken: token, orderId: 'x', productType: 2, refundType: 1 } }, 'com.example.other'),
      voided(newPurchaseToken()),
    ]) {
      expect((await notice(request, other)).status()).toBe(200);
    }
    expect(await upgraded(request)).toBe(true);

    for (let said = 0; said < 2; said += 1) expect((await notice(request, refundNotice(token))).status()).toBe(200);
    expect(await upgraded(request)).toBe(false);
    await refused(await show(request, token), 403, 'withdrawn');
    await refused(await request.get('/api/upgrade/license'), 404, 'no_license');
    await request.dispose();
  }
});

test('a purchase Google has taken back gives no license, new or old', async ({ request }) => {
  const taken = newPurchaseToken();
  await playKnows(request, taken, { purchaseState: 1 });
  await refused(await show(request, taken), 403, 'withdrawn');

  const token = await boughtToken(request);
  await licenseFileIn(await show(request, token));
  await playKnows(request, token, { purchaseState: 1, acknowledgementState: 1 });
  await refused(await show(request, token), 403, 'withdrawn');
  await playKnows(request, token, { acknowledgementState: 1 });
  await refused(await show(request, token), 403, 'withdrawn');
});

test('a notice without the secret, or one that is no notice, withdraws nothing', async ({ request }) => {
  const token = await boughtToken(request);
  await licenseFileIn(await show(request, token));
  expect((await notice(request, voided(token), null)).status()).toBe(403);
  expect((await notice(request, voided(token), 'not-the-secret')).status()).toBe(403);
  expect((await notice(request, {})).status()).toBe(400);
  expect((await notice(request, { message: { data: 'bm90IGpzb24=' } })).status()).toBe(400);
  expect((await notice(request, { message: { data: Buffer.from('{"version":"1.0"}').toString('base64') } })).status()).toBe(400);
  await licenseFileIn(await show(request, token));
});

test('a server with no service account asks Google nothing, and one with no secret hears no notice', async ({ request, playwright }) => {
  const server = await startServer(playwright, NO_PLAY_PORT, { GOOGLE_PLAY_SERVICE_ACCOUNT: '', GOOGLE_PLAY_WEBHOOK_SECRET: '' });
  try {
    const token = await boughtToken(request);
    await refused(await show(server.request, token), 503, 'no_store');
    expect((await notice(server.request, voided(token))).status()).toBe(403);
    expect(await acknowledged(request, token)).toBe(false);
  } finally {
    await server.stop();
  }
});

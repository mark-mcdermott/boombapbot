#!/usr/bin/env node
// Stands in for Stripe, Printful and Google Play while the browser tests
// run, so the shop and a purchase in the Android app can be tried end to end
// without anybody's account. It answers the calls the site makes, remembers
// them, and can be told to fail one.
//
//   POST /v1/checkout/sessions    Stripe: a checkout that is "paid" at once
//   POST /shipping/rates          Printful: what shipping costs to an address
//   POST /orders                  Printful: a draft order
//   POST /orders/:id/confirm      Printful: go ahead
//   GET  /calls                   what the shop has asked so far
//   GET  /calls/upgrade           the checkouts for the upgrade, kept apart so
//                                 the shop's tests and the upgrade's can run
//                                 side by side and each count only its own
//   POST /fail-next-confirm       the next confirm answers 500
//
// Google Play, which is asked about a purchase by its token:
//
//   POST /google/token                       a token for a service account
//                                            whose signature checks out
//   GET  /androidpublisher/v3/applications/:app/purchases/products/:product/tokens/:token
//   POST the same with :acknowledge on the end
//   PUT  /google/purchases/:token            a test says what a token bought
//   GET  /google/purchases/:token            and reads it back
//   POST /google/purchases/:token/fail-next-acknowledge
//                                            its next acknowledgement answers 500

import { createVerify } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 4175);
const calls = [];
const upgradeCalls = [];
let nextId = 1000;
let failNextConfirm = false;

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const GOOGLE_ACCESS = 'fake-google-access-token';
const googlePurchases = new Map();

/** Whether `assertion` is what the tests' service account signs to ask for a token. */
function fromTheServiceAccount(assertion) {
  const [header, claims, signature] = String(assertion).split('.');
  const key = process.env.BOOMBAPBOT_E2E_GOOGLE_PUBLIC_KEY;
  if (!key || !signature) return false;
  if (!createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(key, signature, 'base64url')) return false;
  const { scope, exp } = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'));
  return scope === GOOGLE_SCOPE && exp * 1000 > Date.now();
}

function read(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function answer(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  const text = await read(request);

  if (request.method === 'GET' && pathname === '/calls') return answer(response, 200, calls);
  if (request.method === 'GET' && pathname === '/calls/upgrade') return answer(response, 200, upgradeCalls);
  if (request.method === 'POST' && pathname === '/fail-next-confirm') {
    failNextConfirm = true;
    return answer(response, 200, { ok: true });
  }

  if (request.method === 'POST' && pathname === '/v1/checkout/sessions') {
    const form = Object.fromEntries(new URLSearchParams(text));
    const id = `cs_test_${nextId++}`;
    const log = form['metadata[purpose]'] === 'upgrade' ? upgradeCalls : calls;
    log.push({ service: 'stripe', call: 'checkout', id, form });
    // The buyer "pays" straight away and is sent where a real checkout would send them.
    return answer(response, 200, { id, object: 'checkout.session', url: form.success_url });
  }

  if (request.method === 'POST' && pathname === '/shipping/rates') {
    const body = JSON.parse(text);
    calls.push({ service: 'printful', call: 'rates', body });
    // Dearer abroad, and a second, faster way within the United States.
    const home = body.recipient.country_code === 'US';
    const rates = [
      { id: 'STANDARD', name: 'Flat Rate (Estimated delivery: Jan 5-7) ', rate: home ? '5.00' : '9.50', minDeliveryDays: 4, maxDeliveryDays: 6 },
      ...(home ? [{ id: 'EXPRESS', name: 'Express (Estimated delivery: Jan 3) ', rate: '15.25', minDeliveryDays: 2, maxDeliveryDays: 2 }] : []),
    ];
    return answer(response, 200, { code: 200, result: rates });
  }

  if (request.method === 'POST' && pathname === '/orders') {
    const body = JSON.parse(text);
    const id = nextId++;
    calls.push({ service: 'printful', call: 'create', id, body, token: request.headers.authorization });
    return answer(response, 200, { code: 200, result: { id, external_id: body.external_id, status: 'draft' } });
  }

  const confirm = /^\/orders\/(\d+)\/confirm$/.exec(pathname);
  if (request.method === 'POST' && confirm) {
    const id = Number(confirm[1]);
    const failed = failNextConfirm;
    failNextConfirm = false;
    calls.push({ service: 'printful', call: 'confirm', id, failed });
    if (failed) return answer(response, 500, { code: 500, error: { message: 'Told to fail by the test' } });
    return answer(response, 200, { code: 200, result: { id, status: 'pending' } });
  }

  if (request.method === 'POST' && pathname === '/google/token') {
    const form = new URLSearchParams(text);
    if (!fromTheServiceAccount(form.get('assertion'))) return answer(response, 400, { error: 'invalid_grant' });
    return answer(response, 200, { access_token: GOOGLE_ACCESS, expires_in: 3600, token_type: 'Bearer' });
  }
  const said = /^\/google\/purchases\/([^/]+)(\/fail-next-acknowledge)?$/.exec(pathname);
  if (said) {
    const token = decodeURIComponent(said[1]);
    if (request.method === 'PUT') googlePurchases.set(token, JSON.parse(text));
    if (request.method === 'POST' && said[2] && googlePurchases.has(token)) googlePurchases.get(token).failNextAcknowledge = true;
    return answer(response, googlePurchases.has(token) ? 200 : 404, googlePurchases.get(token) ?? {});
  }
  const asked = /^\/androidpublisher\/v3\/applications\/([^/]+)\/purchases\/products\/([^/]+)\/tokens\/([^/:]+)(:acknowledge)?$/.exec(pathname);
  if (asked) {
    if (request.headers.authorization !== `Bearer ${GOOGLE_ACCESS}`) return answer(response, 401, { error: { code: 401 } });
    const [, app, product, token, acknowledge] = asked;
    const bought = googlePurchases.get(decodeURIComponent(token));
    if (!bought || bought.app !== app || bought.product !== product) return answer(response, 404, { error: { code: 404 } });
    if (request.method === 'GET' && !acknowledge) return answer(response, 200, { kind: 'androidpublisher#productPurchase', ...bought.says });
    if (request.method === 'POST' && acknowledge) {
      const failed = bought.failNextAcknowledge;
      bought.failNextAcknowledge = false;
      if (failed) return answer(response, 500, { error: { code: 500, message: 'Told to fail by the test' } });
      bought.says.acknowledgementState = 1;
      return answer(response, 200, {});
    }
  }

  return answer(response, 404, { error: { message: `The fake has no ${request.method} ${pathname}` } });
}).listen(port, '127.0.0.1', () => {
  console.log(`fake-shop-services: http://127.0.0.1:${port}/`);
});

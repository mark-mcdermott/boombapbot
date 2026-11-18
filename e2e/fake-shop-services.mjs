#!/usr/bin/env node
// Stands in for Stripe and Printful while the browser tests run, so the shop
// can be tried end to end without anybody's account. It answers the three
// calls the site makes, remembers them, and can be told to fail one.
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

import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 4175);
const calls = [];
const upgradeCalls = [];
let nextId = 1000;
let failNextConfirm = false;

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

  return answer(response, 404, { error: { message: `The fake has no ${request.method} ${pathname}` } });
}).listen(port, '127.0.0.1', () => {
  console.log(`fake-shop-services: http://127.0.0.1:${port}/`);
});

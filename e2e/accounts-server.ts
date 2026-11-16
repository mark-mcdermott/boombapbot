import { resolve } from 'node:path';

// The accounts and shop tests run the built server with its API, beside the
// plain static server the rest of the suite uses. Its database lives in
// memory, the email it would send is filed in a folder, and a small fake
// answers for Stripe and Printful, so nothing leaves the machine.

export const ACCOUNTS_PORT = Number(process.env.BOOMBAPBOT_E2E_ACCOUNTS_PORT ?? 4174);
export const ACCOUNTS_URL = `http://127.0.0.1:${ACCOUNTS_PORT}`;
export const OUTBOX = resolve('build/e2e-outbox');

export const FAKE_SERVICES_PORT = Number(process.env.BOOMBAPBOT_E2E_SERVICES_PORT ?? 4175);
export const FAKE_SERVICES_URL = `http://127.0.0.1:${FAKE_SERVICES_PORT}`;
export const SHOP_FIXTURE = resolve('e2e/fixtures/shop.json');

// Made up for the tests, and the same in every process: the server checks
// webhooks against them and the tests sign with them. They open nothing real.
export const STRIPE_WEBHOOK_SECRET = 'browser-tests-only-stripe-webhook';
export const PRINTFUL_WEBHOOK_SECRET = 'browser-tests-only-printful-webhook';

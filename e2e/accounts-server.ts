import { randomBytes } from 'node:crypto';
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

/**
 * What the built server is started with: a database in memory, the outbox in
 * place of real email, and the fake in place of Stripe and Printful. The
 * secrets are made up on the spot and open nothing.
 */
export function serverEnv(port: number): Record<string, string> {
  return {
    HOST: '127.0.0.1',
    PORT: String(port),
    PUBLIC_SITE_URL: `http://127.0.0.1:${port}`,
    DATABASE_URL: 'pglite:memory',
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    EMAIL_OUTBOX: OUTBOX,
    SHOP_CATALOG: SHOP_FIXTURE,
    STRIPE_SECRET_KEY: randomBytes(16).toString('hex'),
    STRIPE_WEBHOOK_SECRET,
    STRIPE_API_URL: FAKE_SERVICES_URL,
    PRINTFUL_API_KEY: randomBytes(16).toString('hex'),
    PRINTFUL_WEBHOOK_SECRET,
    PRINTFUL_API_URL: FAKE_SERVICES_URL,
  };
}

/** A second server the upgrade's tests start for themselves, as the live site is until the upgrade opens. */
export const CLOSED_PORT = Number(process.env.BOOMBAPBOT_E2E_CLOSED_PORT ?? 4176);
export const CLOSED_URL = `http://127.0.0.1:${CLOSED_PORT}`;

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { APPLE_APP_ID, APPLE_ROOT_CA } from './app-store';

// The accounts and shop tests run the built server with its API, beside the
// plain static server the rest of the suite uses. Its database lives in
// memory, the email it would send is filed in a folder, and a small fake
// answers for Stripe, Printful and Google Play, so nothing leaves the machine.
// The App Store's signatures are checked against a root the tests make for
// themselves.

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
export const GOOGLE_PLAY_WEBHOOK_SECRET = 'browser-tests-only-google-play-webhook';

/**
 * The key the test server signs license files with: 32 random bytes, made
 * by whichever process starts the run and handed to its workers through the
 * environment, so the tests can check a signature and no key is in the repo.
 */
export const LICENSE_SIGNING_KEY = (process.env.BOOMBAPBOT_E2E_LICENSE_SIGNING_KEY ??= randomBytes(32).toString('base64url'));

/**
 * The key of a service account made up for the run, as the license signing
 * key is. The server signs with it to ask the fake Google for a token, and
 * the fake, started by the same process, checks that with the public half.
 */
const GOOGLE_PRIVATE_KEY = (process.env.BOOMBAPBOT_E2E_GOOGLE_PRIVATE_KEY ??= (() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.BOOMBAPBOT_E2E_GOOGLE_PUBLIC_KEY = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
})());

/** The key file Google hands out for a service account, with the fake where its tokens come from. */
export const GOOGLE_PLAY_SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  client_email: 'browser-tests@boombapbot-tests.iam.gserviceaccount.com',
  private_key: GOOGLE_PRIVATE_KEY,
  token_uri: `${FAKE_SERVICES_URL}/google/token`,
});

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
    LICENSE_SIGNING_KEY,
    APPLE_APP_ID,
    APPLE_ROOT_CA,
    GOOGLE_PLAY_SERVICE_ACCOUNT,
    GOOGLE_PLAY_WEBHOOK_SECRET,
    GOOGLE_PLAY_API_URL: FAKE_SERVICES_URL,
    PRINTFUL_API_KEY: randomBytes(16).toString('hex'),
    PRINTFUL_WEBHOOK_SECRET,
    PRINTFUL_API_URL: FAKE_SERVICES_URL,
  };
}

/** A second server the upgrade's tests start for themselves, as the live site is until the upgrade opens. */
export const CLOSED_PORT = Number(process.env.BOOMBAPBOT_E2E_CLOSED_PORT ?? 4176);
export const CLOSED_URL = `http://127.0.0.1:${CLOSED_PORT}`;

/** One the store purchase tests start with no app named, as the live site is until the app has a record at Apple. */
export const NO_STORE_PORT = Number(process.env.BOOMBAPBOT_E2E_NO_STORE_PORT ?? 4181);

/** And one with no service account, as the live site is until the owner has made one at Google. */
export const NO_PLAY_PORT = Number(process.env.BOOMBAPBOT_E2E_NO_PLAY_PORT ?? 4182);

/** Another the accounts tests start, with its limits on and its database kept in a folder. */
export const LIMITED_PORT = Number(process.env.BOOMBAPBOT_E2E_LIMITED_PORT ?? 4177);
export const LIMITED_URL = `http://127.0.0.1:${LIMITED_PORT}`;
export const LIMITED_DATABASE = resolve('build/e2e-limited-db');

/** One the upgrade's tests start with an outbox that cannot be written, so every email it tries fails. */
export const BROKEN_MAIL_PORT = Number(process.env.BOOMBAPBOT_E2E_BROKEN_MAIL_PORT ?? 4178);

/** The phone app's page, served to a browser and pointed at the accounts server, as the app is at the site. */
export const APP_PORT = Number(process.env.BOOMBAPBOT_E2E_APP_PORT ?? 4179);
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;

/** The desktop app's page, served to a browser the same way. */
export const DESKTOP_APP_PORT = Number(process.env.BOOMBAPBOT_E2E_DESKTOP_APP_PORT ?? 4180);
export const DESKTOP_APP_URL = `http://127.0.0.1:${DESKTOP_APP_PORT}`;

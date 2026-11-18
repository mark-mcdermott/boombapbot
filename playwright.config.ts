import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import {
  ACCOUNTS_PORT,
  ACCOUNTS_URL,
  FAKE_SERVICES_PORT,
  FAKE_SERVICES_URL,
  OUTBOX,
  PRINTFUL_WEBHOOK_SECRET,
  SHOP_FIXTURE,
  STRIPE_WEBHOOK_SECRET,
} from './e2e/accounts-server';

const port = Number(process.env.BOOMBAPBOT_E2E_PORT ?? 4173);
const withServer = /(accounts|beats|shop)\.spec\.ts/;
// РИТМ-12's tests of its own panel are in e2e/ritm12. The tests in the e2e
// folder itself are the site's, and drive the same machine.
const panel = /\/ritm12\/.*\.spec\.ts/;
const panelPhone = /\/ritm12\/phone\.spec\.ts/;
const desktop = { ...devices['Desktop Chrome'] };
const projects = [
  { name: 'ritm12', use: desktop, testMatch: panel, testIgnore: panelPhone },
  { name: 'ritm12-phone', use: { ...devices['Pixel 7'] }, testMatch: panelPhone },
  { name: 'site', use: desktop, testIgnore: [withServer, panel] },
  { name: 'server', use: { ...desktop, baseURL: ACCOUNTS_URL }, testMatch: withServer },
];

// The tests run against the production build. Run `pnpm build` first.
//
// Most of them use apps/site/dist/client served as plain static files, which
// is how the machine has to work: with no server behind it at all. The
// accounts and shop tests use the built server instead, with a database that
// lives in memory, an outbox folder in place of real email, and a fake that
// answers for Stripe and Printful. So do the saved beats tests.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off',
  },
  projects,
  webServer: [
    {
      command: `node scripts/serve-dist.mjs --port ${port}`,
      url: `http://127.0.0.1:${port}/boombapbot-assets.json`,
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
    },
    {
      command: 'node apps/site/dist/server/entry.mjs',
      url: `${ACCOUNTS_URL}/api/auth/ok`,
      env: {
        HOST: '127.0.0.1',
        PORT: String(ACCOUNTS_PORT),
        PUBLIC_SITE_URL: ACCOUNTS_URL,
        DATABASE_URL: 'pglite:memory',
        BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
        EMAIL_OUTBOX: OUTBOX,
        // Every test signs up from one address, faster than the limiter allows.
        AUTH_RATE_LIMIT: 'off',
        SHOP_CATALOG: SHOP_FIXTURE,
        STRIPE_SECRET_KEY: randomBytes(16).toString('hex'),
        STRIPE_WEBHOOK_SECRET,
        STRIPE_API_URL: FAKE_SERVICES_URL,
        PRINTFUL_API_KEY: randomBytes(16).toString('hex'),
        PRINTFUL_WEBHOOK_SECRET,
        PRINTFUL_API_URL: FAKE_SERVICES_URL,
      },
      // Never reused: its database and its secret belong to one run.
      reuseExistingServer: false,
      timeout: 20_000,
    },
    {
      command: `node e2e/fake-shop-services.mjs ${FAKE_SERVICES_PORT}`,
      url: `${FAKE_SERVICES_URL}/calls`,
      reuseExistingServer: false,
      timeout: 10_000,
    },
  ],
});

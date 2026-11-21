import { defineConfig, devices } from '@playwright/test';
import {
  ACCOUNTS_PORT,
  ACCOUNTS_URL,
  APP_PORT,
  APP_URL,
  DESKTOP_APP_PORT,
  DESKTOP_APP_URL,
  FAKE_SERVICES_PORT,
  FAKE_SERVICES_URL,
  serverEnv,
} from './e2e/accounts-server';

const port = Number(process.env.BOOMBAPBOT_E2E_PORT ?? 4173);
const withServer = /(accounts|avatars|beats|shop|upgrade)\.spec\.ts/;
// The phone app's page, in a phone's browser, reaching the same built server from outside it.
const app = /\/app\.spec\.ts/;
// And the desktop app's page, the same way.
const desktopApp = /\/desktop-app\.spec\.ts/;
// РИТМ-12's tests of its own panel are in e2e/ritm12. The tests in the e2e
// folder itself are the site's, and drive the same machine.
const panel = /\/ritm12\/.*\.spec\.ts/;
const panelPhone = /\/ritm12\/phone\.spec\.ts/;
// The tests run in Chromium, which is what CI has. To try another engine,
// install it once (`pnpm exec playwright install webkit firefox`) and name it:
// `BOOMBAPBOT_E2E_BROWSER=webkit pnpm test:e2e`. Firefox cannot pretend to
// be a phone, so its phone is a desktop browser in a phone's window.
const BROWSERS = {
  chromium: { desktop: devices['Desktop Chrome'], phone: devices['Pixel 7'] },
  webkit: { desktop: devices['Desktop Safari'], phone: devices['iPhone 15'] },
  firefox: { desktop: devices['Desktop Firefox'], phone: { ...devices['Desktop Firefox'], viewport: { width: 412, height: 839 } } },
} as const;
const browserName = (process.env.BOOMBAPBOT_E2E_BROWSER ?? 'chromium') as keyof typeof BROWSERS;
const browser = BROWSERS[browserName];
if (!browser) throw new Error(`BOOMBAPBOT_E2E_BROWSER must be one of ${Object.keys(BROWSERS).join(', ')}`);
const desktop = { ...browser.desktop };
const projects = [
  { name: 'ritm12', use: desktop, testMatch: panel, testIgnore: panelPhone },
  { name: 'ritm12-phone', use: { ...browser.phone }, testMatch: panelPhone },
  { name: 'site', use: desktop, testIgnore: [withServer, panel, app, desktopApp] },
  { name: 'server', use: { ...desktop, baseURL: ACCOUNTS_URL }, testMatch: withServer },
  { name: 'app', use: { ...browser.phone, baseURL: APP_URL }, testMatch: app },
  { name: 'desktop-app', use: { ...desktop, baseURL: DESKTOP_APP_URL }, testMatch: desktopApp },
];

// The tests run against the production build. Run `pnpm build` first.
//
// Most of them use apps/site/dist/client served as plain static files, which
// is how the machine has to work: with no server behind it at all. The
// accounts, shop and upgrade tests use the built server instead, with a database that
// lives in memory, an outbox folder in place of real email, and a fake that
// answers for Stripe and Printful. So do the saved beats tests.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  // Firefox takes several times as long over an accessibility scan as the other two.
  timeout: browserName === 'firefox' ? 60_000 : 30_000,
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
        ...serverEnv(ACCOUNTS_PORT),
        // Every test signs up from one address, faster than the limiter allows.
        AUTH_RATE_LIMIT: 'off',
        UPGRADE_OPEN: 'on',
        APP_ORIGINS: `${APP_URL},${DESKTOP_APP_URL}`,
      },
      // Never reused: its database and its secret belong to one run.
      reuseExistingServer: false,
      timeout: 20_000,
    },
    {
      command: `pnpm --filter @boombapbot/mobile assets && pnpm --filter @boombapbot/mobile exec vite --host 127.0.0.1 --port ${APP_PORT} --strictPort`,
      url: `${APP_URL}/boombapbot-pages.json`,
      env: { VITE_SITE_URL: `${ACCOUNTS_URL}/` },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @boombapbot/desktop assets && pnpm --filter @boombapbot/desktop exec vite --host 127.0.0.1 --port ${DESKTOP_APP_PORT} --strictPort`,
      url: DESKTOP_APP_URL,
      env: { VITE_SITE_URL: `${ACCOUNTS_URL}/` },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `node e2e/fake-shop-services.mjs ${FAKE_SERVICES_PORT}`,
      url: `${FAKE_SERVICES_URL}/calls`,
      reuseExistingServer: false,
      timeout: 10_000,
    },
  ],
});

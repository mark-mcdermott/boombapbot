import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.BOOMBAPBOT_E2E_PORT ?? 4173);

// The tests run against the production build in apps/site/dist, served as
// plain static files. Run `pnpm build` first.
export default defineConfig({
  testDir: 'e2e',
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
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /phone\.spec\.ts/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /phone\.spec\.ts/ },
  ],
  webServer: {
    command: `node scripts/serve-dist.mjs --port ${port}`,
    url: `http://127.0.0.1:${port}/boombapbot-assets.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});

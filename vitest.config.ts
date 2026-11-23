import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The site's server code reads its settings from Astro and its migrations
  // into an in-process database. Outside Astro the tests stand in for both.
  resolve: { alias: { 'astro:env/server': fileURLToPath(new URL('./apps/site/test/astro-env.ts', import.meta.url)) } },
  define: { __LOCAL_DATABASE__: 'true' },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});

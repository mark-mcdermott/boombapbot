import node from '@astrojs/node';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, envField } from 'astro/config';

const onVercel = Boolean(process.env.VERCEL);
// The drum machine this build is. Only its package is ever imported.
const machine = `@boombapbot/machine-${process.env.BOOMBAPBOT_MACHINE ?? 'ritm12'}`;

// Read when a request needs it, never at build time, so a build succeeds
// with none of them set and a missing one is named by whatever asks for it.
const atRunTime = () => envField.string({ context: 'server', access: 'secret', optional: true });

// Every page is prerendered; only the routes under /api run on a server.
// Vercel gets its own adapter. Anywhere else the build is the static pages
// (dist/client) beside a small Node server (dist/server), which is what the
// account tests run.
export default defineConfig({
  site: 'https://boombapbot.com',
  output: 'static',
  adapter: onVercel ? vercel() : node({ mode: 'standalone' }),
  integrations: [react()],
  devToolbar: { enabled: false },
  env: {
    schema: {
      PUBLIC_SITE_URL: atRunTime(),
      DATABASE_URL: atRunTime(),
      BETTER_AUTH_SECRET: atRunTime(),
      RESEND_API_KEY: atRunTime(),
      EMAIL_FROM: atRunTime(),
      EMAIL_OUTBOX: atRunTime(),
      AUTH_RATE_LIMIT: atRunTime(),
      STRIPE_SECRET_KEY: atRunTime(),
      STRIPE_WEBHOOK_SECRET: atRunTime(),
      STRIPE_API_URL: atRunTime(),
      PRINTFUL_API_KEY: atRunTime(),
      PRINTFUL_STORE_ID: atRunTime(),
      PRINTFUL_WEBHOOK_SECRET: atRunTime(),
      PRINTFUL_API_URL: atRunTime(),
      SHOP_CATALOG: atRunTime(),
    },
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: [
        { find: '#machine/document', replacement: `${machine}/document` },
        { find: '#machine', replacement: machine },
      ],
    },
    // The in-process database is for tests and offline work. A Vercel build
    // drops it, driver and all.
    define: { __LOCAL_DATABASE__: JSON.stringify(!onVercel) },
  },
});

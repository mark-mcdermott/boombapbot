import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// v0.1 is a static site: no API routes, accounts or env vars. The Vercel
// adapter is applied only on Vercel's build machines, so local builds stay
// plain static output that `astro preview` can serve.
export default defineConfig({
  site: 'https://boombapbot.com',
  output: 'static',
  adapter: process.env.VERCEL ? vercel() : undefined,
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
  },
});

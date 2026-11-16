import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs outside Astro, so it reads the env file itself.
// `generate` only reads the schema and needs no URL; `migrate` fails on its
// own, clearly, without one.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  verbose: true,
  strict: true,
});

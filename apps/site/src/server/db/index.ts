import { DATABASE_URL } from 'astro:env/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** `pglite:memory`, or `pglite:` and a folder, opens a database inside this process. */
const LOCAL_SCHEME = 'pglite:';

let opened: Promise<Db> | null = null;

async function open(): Promise<Db> {
  const url = DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy apps/site/.env.example to apps/site/.env, or set it in Vercel.');
  }
  if (__LOCAL_DATABASE__ && url.startsWith(LOCAL_SCHEME)) {
    const { openLocalDatabase } = await import('./local');
    return openLocalDatabase(url.slice(LOCAL_SCHEME.length));
  }
  return drizzle(neon(url), { schema });
}

/**
 * The database, opened on first use. Astro runs module top-level code at
 * build time too, where there is no URL to open.
 */
export function getDb(): Promise<Db> {
  opened ??= open().catch((error: unknown) => {
    opened = null;
    throw error;
  });
  return opened;
}

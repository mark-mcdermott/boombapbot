import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { Db } from './index';
import * as schema from './schema';

// The committed migrations, read at build time so the built server needs no
// path back to the repo. Their file names sort in the order they apply.
const migrations = import.meta.glob<string>('../../../drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * A Postgres that runs inside this process, built from the same migrations as
 * the real one. The browser tests use it, and it works with no network.
 * `memory` keeps nothing; anything else is a folder to keep it in.
 */
export async function openLocalDatabase(location: string): Promise<Db> {
  const client = new PGlite(location === 'memory' ? undefined : location);
  for (const file of Object.keys(migrations).sort()) {
    await client.exec(migrations[file] ?? '');
  }
  return drizzle(client, { schema });
}

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

/** Which migrations a database kept in a folder has had, so that opening it again applies only the new ones. */
const APPLIED = 'local_migrations';

/**
 * A Postgres that runs inside this process, built from the same migrations as
 * the real one. The browser tests use it, and it works with no network.
 * `memory` keeps nothing; anything else is a folder to keep it in, and a
 * folder opened again is the database it was.
 */
export async function openLocalDatabase(location: string): Promise<Db> {
  const client = new PGlite(location === 'memory' ? undefined : location);
  await client.exec(`CREATE TABLE IF NOT EXISTS "${APPLIED}" ("file" text PRIMARY KEY)`);
  const applied = await client.query<{ file: string }>(`SELECT "file" FROM "${APPLIED}"`);
  const done = new Set(applied.rows.map((row) => row.file));
  for (const file of Object.keys(migrations).sort()) {
    if (done.has(file)) continue;
    await client.exec(migrations[file] ?? '');
    await client.query(`INSERT INTO "${APPLIED}" ("file") VALUES ($1)`, [file]);
  }
  return drizzle(client, { schema });
}

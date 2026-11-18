import { eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getAuth } from './auth';
import { getDb } from './db';
import { license, user } from './db/schema';

/** An account as the server knows it. */
export interface SignedInUser {
  /** The row id, for joins. It stays on the server. */
  id: number;
  /** The account's public name, for anything that leaves the server. */
  uuid: string;
  email: string;
}

async function findUser(match: SQL): Promise<SignedInUser | null> {
  const db = await getDb();
  const [found] = await db
    .select({ id: user.id, uuid: user.uuid, email: user.email })
    .from(user)
    .where(match)
    .limit(1);
  return found ?? null;
}

/**
 * Who is asking, or null. There is no middleware: each handler asks for
 * itself, so each is safe when reached directly.
 */
export async function resolveUser(request: Request): Promise<SignedInUser | null> {
  const session = await (await getAuth()).api.getSession({ headers: request.headers });
  return session ? findUser(eq(user.email, session.user.email)) : null;
}

/**
 * The account with that uuid, or null: for a webhook, which hears about an
 * account from Stripe and has nobody signed in.
 */
export async function userByUuid(uuid: string | undefined): Promise<SignedInUser | null> {
  const named = z.uuid().safeParse(uuid);
  return named.success ? findUser(eq(user.uuid, named.data)) : null;
}

/**
 * Whether an account holds a license for the upgrade. It is asked apart
 * from who is calling, so a route that does not care never reads the
 * licenses table.
 */
export async function isUpgraded(account: SignedInUser): Promise<boolean> {
  const db = await getDb();
  return (await db.$count(license, eq(license.userId, account.id))) > 0;
}

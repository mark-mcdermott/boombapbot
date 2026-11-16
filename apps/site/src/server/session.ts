import { eq } from 'drizzle-orm';
import { getAuth } from './auth';
import { getDb } from './db';
import { user } from './db/schema';

export interface SignedInUser {
  /** The row id, for joins. It stays on the server. */
  id: number;
  email: string;
}

/**
 * Who is asking, or null. There is no middleware: each handler asks for
 * itself, so each is safe when reached directly.
 */
export async function resolveUser(request: Request): Promise<SignedInUser | null> {
  const session = await (await getAuth()).api.getSession({ headers: request.headers });
  if (!session) return null;
  const db = await getDb();
  const [found] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.email, session.user.email))
    .limit(1);
  return found ?? null;
}

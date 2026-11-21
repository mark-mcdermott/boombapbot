import {
  AVATAR_ROUTE,
  MAX_AVATAR_BYTES,
  avatarTypeOf,
  formatKilobytes,
  type AvatarRefusal,
  type AvatarType,
} from '@boombapbot/contracts';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from './db';
import { avatar, user } from './db/schema';
import type { SignedInUser } from './session';
import { json } from './site';

const STATUS: Record<AvatarRefusal, number> = { signed_out: 401, invalid: 400, too_large: 413 };

const MESSAGES: Record<AvatarRefusal, string> = {
  signed_out: 'Log in to change your picture.',
  invalid: 'That is not a picture I can keep. Try a JPEG, a PNG or a WebP.',
  too_large: `That picture is too large. I can keep one up to ${formatKilobytes(MAX_AVATAR_BYTES)}.`,
};

export function refuseAvatar(code: AvatarRefusal): Response {
  return json({ code, message: MESSAGES[code] }, STATUS[code]);
}

/**
 * The body as bytes, or null when it is larger than a picture may be. It is
 * read to its end either way, as a beat's is: an answer sent while the body
 * is still arriving breaks the connection it came on.
 */
async function readBytes(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const kept = new Uint8Array(MAX_AVATAR_BYTES);
  let bytes = 0;
  for await (const chunk of request.body) {
    if (bytes + chunk.byteLength <= MAX_AVATAR_BYTES) kept.set(chunk, bytes);
    bytes += chunk.byteLength;
  }
  return bytes > MAX_AVATAR_BYTES ? null : kept.subarray(0, bytes);
}

/** A picture as sent, with its kind read from its own bytes, or why it is not kept. */
export async function readAvatar(request: Request): Promise<{ bytes: Uint8Array; type: AvatarType } | AvatarRefusal> {
  const bytes = await readBytes(request);
  if (!bytes) return 'too_large';
  const type = avatarTypeOf(bytes);
  return type ? { bytes, type } : 'invalid';
}

/**
 * Keeps a picture as the account's only one and answers with where it is
 * served. The picture and the account's `image` change in one statement, so
 * the account never names a picture that is not there.
 */
export async function saveAvatar(account: SignedInUser, bytes: Uint8Array, type: AvatarType): Promise<string | null> {
  const db = await getDb();
  const data = Buffer.from(bytes).toString('base64');
  const kept = db.$with('kept').as(
    db
      .insert(avatar)
      .values({ userId: account.id, type, data })
      .onConflictDoUpdate({
        target: avatar.userId,
        set: { uuid: sql`gen_random_uuid()`, type, data, createdAt: sql`now()` },
      })
      .returning({ uuid: avatar.uuid, userId: avatar.userId }),
  );
  const [named] = await db
    .with(kept)
    .update(user)
    .set({ image: sql`${AVATAR_ROUTE}::text || ${kept.uuid}::text`, updatedAt: sql`now()` })
    .from(kept)
    .where(eq(user.id, kept.userId))
    .returning({ image: user.image });
  return named?.image ?? null;
}

/** Takes the account's picture away, in one statement, whether or not it had one. */
export async function removeAvatar(account: SignedInUser): Promise<void> {
  const db = await getDb();
  const gone = db.$with('gone').as(db.delete(avatar).where(eq(avatar.userId, account.id)).returning({ id: avatar.id }));
  await db.with(gone).update(user).set({ image: null, updatedAt: sql`now()` }).where(eq(user.id, account.id));
}

/** The picture with that uuid, as bytes, or null. Anybody who has its address may see it, as with any picture on a page. */
export async function findAvatar(id: string | undefined): Promise<{ type: AvatarType; bytes: Buffer } | null> {
  const uuid = z.uuid().safeParse(id);
  if (!uuid.success) return null;
  const db = await getDb();
  const [found] = await db.select({ type: avatar.type, data: avatar.data }).from(avatar).where(eq(avatar.uuid, uuid.data)).limit(1);
  return found ? { type: found.type, bytes: Buffer.from(found.data, 'base64') } : null;
}

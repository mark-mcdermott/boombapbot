import type { APIRoute } from 'astro';
import { FREE_BEAT_LIMIT, SaveBeatRequestSchema } from '@boombapbot/contracts';
import { desc, eq } from 'drizzle-orm';
import { beatSummary, readBeatRequest, refuse, saveNewBeat, signedIn } from '../../../server/beats';
import { getDb } from '../../../server/db';
import { beat } from '../../../server/db/schema';
import { json } from '../../../server/site';

export const prerender = false;

/** The beats saved to the account that is asking, newest first, and how many it may hold. */
export const GET: APIRoute = async ({ request }) => {
  const asked = await signedIn(request);
  if ('refusal' in asked) return asked.refusal;
  const db = await getDb();
  const beats = await db
    .select(beatSummary)
    .from(beat)
    .where(eq(beat.userId, asked.user.id))
    .orderBy(desc(beat.updatedAt), desc(beat.id));
  return json({ beats, limit: FREE_BEAT_LIMIT });
};

/** Saves a project as a new beat, while the account has room for one. */
export const POST: APIRoute = async ({ request }) => {
  const asked = await readBeatRequest(request, SaveBeatRequestSchema);
  if ('refusal' in asked) return asked.refusal;
  const saved = await saveNewBeat(asked.user, asked.project, asked.bytes);
  return saved ? json({ beat: saved }, 201) : refuse('limit');
};

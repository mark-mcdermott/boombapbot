import type { APIRoute } from 'astro';
import {
  RenameBeatRequestSchema,
  ReplaceBeatRequestSchema,
  beatBytes,
  beatTooLarge,
  cloudCopyIsNewer,
} from '@boombapbot/contracts';
import { and, eq } from 'drizzle-orm';
import {
  beatSummary,
  deleteBeat,
  ownedBeat,
  readBeatChange,
  readBeatRequest,
  refuse,
  signedIn,
} from '../../../server/beats';
import { getDb } from '../../../server/db';
import { beat } from '../../../server/db/schema';
import { json } from '../../../server/site';

export const prerender = false;

/** One saved beat with its project, to put on the machine. */
export const GET: APIRoute = async ({ request, params }) => {
  const asked = await signedIn(request);
  if ('refusal' in asked) return asked.refusal;
  const owned = ownedBeat(asked.user, params.id);
  if (!owned) return refuse('not_found');
  const db = await getDb();
  const [found] = await db.select({ ...beatSummary, project: beat.project }).from(beat).where(owned).limit(1);
  if (!found) return refuse('not_found');
  const { project, ...summary } = found;
  return json({ beat: summary, project });
};

/**
 * Replaces a saved beat with the project sent. The last save wins, with one
 * guard: if the cloud copy was saved after the one this device last had, the
 * answer is a conflict carrying that copy's time, and nothing changes until
 * the request comes back saying to overwrite.
 */
export const PUT: APIRoute = async ({ request, params }) => {
  const asked = await readBeatRequest(request, ReplaceBeatRequestSchema);
  if ('refusal' in asked) return asked.refusal;
  const { user, project, bytes } = asked;
  const { lastSeen, overwrite } = asked.data;
  const owned = ownedBeat(user, params.id);
  if (!owned) return refuse('not_found');

  const db = await getDb();
  const current = () => db.select({ id: beat.id, updatedAt: beat.updatedAt }).from(beat).where(owned).limit(1);
  const [before] = await current();
  if (!before) return refuse('not_found');
  if (!overwrite && cloudCopyIsNewer(before.updatedAt, lastSeen)) {
    return refuse('conflict', { updatedAt: before.updatedAt });
  }

  // Always later than the copy it replaces, so every other device sees it as newer.
  const now = new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1));
  // Without `overwrite` the row must still be the one just read: a save that
  // landed in between is a conflict too, not something to write over unasked.
  const untouched = overwrite ? undefined : eq(beat.updatedAt, before.updatedAt);
  const [saved] = await db
    .update(beat)
    .set({ name: project.name, project, bytes, updatedAt: now })
    .where(and(eq(beat.id, before.id), untouched))
    .returning(beatSummary);
  if (saved) return json({ beat: saved });

  const [after] = await current();
  return after ? refuse('conflict', { updatedAt: after.updatedAt }) : refuse('not_found');
};

/**
 * Gives a saved beat another name, in its row and in its project, which carry
 * the same one. When it was saved stays as it was: the beat itself has not
 * changed, so a device that has it is not behind. The row must still be the
 * one just read, as with a save, so a save that lands in between is not undone.
 */
export const PATCH: APIRoute = async ({ request, params }) => {
  const asked = await readBeatChange(request, RenameBeatRequestSchema);
  if ('refusal' in asked) return asked.refusal;
  const owned = ownedBeat(asked.user, params.id);
  if (!owned) return refuse('not_found');

  const db = await getDb();
  const [before] = await db
    .select({ id: beat.id, project: beat.project, updatedAt: beat.updatedAt })
    .from(beat)
    .where(owned)
    .limit(1);
  if (!before) return refuse('not_found');
  const project = { ...before.project, name: asked.data.name };
  const bytes = beatBytes(project);
  if (beatTooLarge(bytes)) return refuse('too_large');
  const [renamed] = await db
    .update(beat)
    .set({ name: project.name, project, bytes })
    .where(and(eq(beat.id, before.id), eq(beat.updatedAt, before.updatedAt)))
    .returning(beatSummary);
  return renamed ? json({ beat: renamed }) : refuse('conflict');
};

/** Deletes a saved beat for good. */
export const DELETE: APIRoute = async ({ request, params }) => {
  const asked = await signedIn(request);
  if ('refusal' in asked) return asked.refusal;
  const owned = ownedBeat(asked.user, params.id);
  if (!owned) return refuse('not_found');
  const removed = await deleteBeat(owned);
  return removed ? json(removed) : refuse('not_found');
};

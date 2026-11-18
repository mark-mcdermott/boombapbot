import {
  FREE_BEAT_LIMIT,
  MAX_BEAT_BYTES,
  beatBytes,
  beatTooLarge,
  createProjectCodec,
  formatKilobytes,
  type BeatRefusal,
  type ProjectBase,
} from '@boombapbot/contracts';
import { documentKind } from '#machine/document';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { beat } from './db/schema';
import { resolveUser, type SignedInUser } from './session';
import { json } from './site';

const STATUS: Record<BeatRefusal, number> = {
  signed_out: 401,
  invalid: 400,
  too_large: 413,
  limit: 403,
  conflict: 409,
  not_found: 404,
};

const MESSAGES: Record<BeatRefusal, string> = {
  signed_out: 'Log in to save beats to your account.',
  invalid: 'That is not a boombapbot project, so I did not save it.',
  too_large: `That beat is too large to save. I can keep beats up to ${formatKilobytes(MAX_BEAT_BYTES)} each.`,
  limit: `Your account is full: it holds ${FREE_BEAT_LIMIT} beats. Delete one to save another.`,
  conflict: 'The copy in your account was saved after the one on this device.',
  not_found: 'That beat is not in your account.',
};

/** The answer when a request is turned down: why, in a word and in a sentence. */
export function refuse(code: BeatRefusal, extra?: { updatedAt?: Date; message?: string }): Response {
  return json({ code, message: MESSAGES[code], ...extra }, STATUS[code]);
}

/**
 * For a beat of the machine this site had before. Only a page left open since
 * then still sends one, and that page shows what it is told under the codes
 * it already knows, so this goes out as `invalid` with words of its own.
 */
const FROM_AN_EARLIER_PAGE =
  'I changed the machine after you opened this page, so I did not save this. Reload the page: your beat opens on the new machine, and you can save it from there.';

/** A beat as it leaves the server: named by its uuid, without its project or its row id. */
export const beatSummary = {
  id: beat.uuid,
  name: beat.name,
  bytes: beat.bytes,
  createdAt: beat.createdAt,
  updatedAt: beat.updatedAt,
};

type Refused = { refusal: Response };

/** Who is asking. Every beats route starts here, so none answers without a session. */
export async function signedIn(request: Request): Promise<{ user: SignedInUser } | Refused> {
  const user = await resolveUser(request);
  return user ? { user } : { refusal: refuse('signed_out') };
}

/**
 * One beat of this user's, by the uuid in the address. Somebody else's beat
 * matches nothing, so it is answered exactly as one that does not exist.
 */
export function ownedBeat(user: SignedInUser, id: string | undefined) {
  const uuid = z.uuid().safeParse(id);
  return uuid.success ? and(eq(beat.uuid, uuid.data), eq(beat.userId, user.id)) : null;
}

/** Reads the projects of the machine this build is, and can tell one the machine before it made. */
const codec = createProjectCodec([documentKind]);

/** Room for the few fields a request carries beside the project. */
const ENVELOPE_BYTES = 1024;

/**
 * The body as text, or null when it is larger than any beat may be. It is
 * read to its end either way, without being kept: an answer sent while the
 * body is still arriving breaks the connection it came on.
 */
async function readBody(request: Request): Promise<string | null> {
  if (!request.body) return '';
  const limit = MAX_BEAT_BYTES + ENVELOPE_BYTES;
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for await (const chunk of request.body) {
    bytes += chunk.byteLength;
    if (bytes <= limit) text += decoder.decode(chunk, { stream: true });
  }
  return bytes > limit ? null : text + decoder.decode();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Reads a beat to save: who is saving it, and the project, weighed and then
 * checked against the project schema. What comes back is either what the
 * handler needs, or the answer to give instead.
 */
export async function readBeatRequest<Body extends { project?: unknown }>(
  request: Request,
  schema: z.ZodType<Body>,
): Promise<{ user: SignedInUser; data: Body; project: ProjectBase; bytes: number } | Refused> {
  const asked = await signedIn(request);
  if ('refusal' in asked) return asked;
  const text = await readBody(request);
  if (text === null) return { refusal: refuse('too_large') };
  const body = schema.safeParse(parseJson(text));
  if (!body.success) return { refusal: refuse('invalid') };
  if (beatTooLarge(beatBytes(body.data.project))) return { refusal: refuse('too_large') };
  // Only this machine's own beats are stored. One it could take over is not
  // converted here: the page does that, where the person sees what changed.
  const parsed = codec.parseOwned(body.data.project);
  if (!parsed.ok) {
    const earlier = codec.parse(body.data.project).ok;
    return { refusal: refuse('invalid', earlier ? { message: FROM_AN_EARLIER_PAGE } : undefined) };
  }
  return { user: asked.user, data: body.data, project: parsed.project, bytes: beatBytes(parsed.project) };
}

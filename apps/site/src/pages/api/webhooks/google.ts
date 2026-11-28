import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { GOOGLE_PLAY_WEBHOOK_SECRET } from 'astro:env/server';
import { z } from 'zod';
import { json } from '../../../server/site';
import { voidedByGoogleNotice } from '../../../server/store/google';
import { withdrawStorePurchase } from '../../../server/store/license';

export const prerender = false;

const PushSchema = z.object({ message: z.object({ data: z.string().min(1) }) });

/** Google's notices come by Cloud Pub/Sub, which is given this address with a secret in it, as Printful is. */
function carriesSecret(request: Request): boolean {
  if (!GOOGLE_PLAY_WEBHOOK_SECRET) return false;
  const given = Buffer.from(new URL(request.url).searchParams.get('secret') ?? '');
  const expected = Buffer.from(GOOGLE_PLAY_WEBHOOK_SECRET);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Google Play's notices about purchases, pushed here by Pub/Sub. A purchase
 * refunded or taken back withdraws its license; Google has no way to undo
 * that. A notice about anything else is taken and dropped, so that Pub/Sub
 * stops sending it. An error is meant to reach Pub/Sub, which sends again.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!carriesSecret(request)) return json({ message: 'Not allowed.' }, 403);
  const pushed = PushSchema.safeParse(await request.json().catch(() => null));
  const voided = pushed.success ? voidedByGoogleNotice(pushed.data.message.data) : undefined;
  if (voided === undefined) return json({ message: 'This is not a notice from Google Play.' }, 400);
  if (voided) await withdrawStorePurchase({ store: 'google', id: voided });
  return json({ received: true });
};

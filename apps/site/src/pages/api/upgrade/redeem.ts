import type { APIRoute } from 'astro';
import { RedeemKeyRequestSchema } from '@boombapbot/contracts';
import { resolveUser } from '../../../server/session';
import { json } from '../../../server/site';
import { redeemKey, refuse } from '../../../server/upgrade';

export const prerender = false;

/** Puts a key bought without an account onto the account that is asking. */
export const POST: APIRoute = async ({ request }) => {
  const account = await resolveUser(request);
  if (!account) return refuse('signed_out');
  const asked = RedeemKeyRequestSchema.safeParse(await request.json().catch(() => null));
  if (!asked.success) return refuse('invalid');
  const refusal = await redeemKey(account, asked.data.key);
  return refusal ? refuse(refusal) : json({ upgraded: true });
};

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { json } from '../../../server/site';
import { appleStoreOpen, readAppleNotice } from '../../../server/store/apple';
import { reinstateApplePurchase, withdrawApplePurchase } from '../../../server/store/license';

export const prerender = false;

const NoticeSchema = z.object({ signedPayload: z.string().min(1) });

/**
 * The App Store calls this when something happens to a purchase. Only a
 * notice it signed is acted on: a refund or a purchase taken back withdraws
 * the license, and a refund undone gives it back. An error is meant to
 * reach Apple, which then sends the notice again.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!appleStoreOpen()) return json({ message: 'App Store purchases are not set up.' }, 503);
  const sent = NoticeSchema.safeParse(await request.json().catch(() => null));
  if (!sent.success) return json({ message: 'This is not a notice from the App Store.' }, 400);
  const notice = await readAppleNotice(sent.data.signedPayload);
  if (notice === undefined) return json({ message: 'The signature does not match.' }, 400);
  if (notice?.effect === 'withdraw') await withdrawApplePurchase(notice.purchase);
  if (notice?.effect === 'reinstate') await reinstateApplePurchase(notice.purchase);
  return json({ received: true });
};

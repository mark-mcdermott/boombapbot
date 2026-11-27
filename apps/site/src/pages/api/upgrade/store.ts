import type { APIRoute } from 'astro';
import { StorePurchaseRequestSchema } from '@boombapbot/contracts';
import { requestAddress } from '../../../server/auth';
import { consumeRateLimit } from '../../../server/rate-limit';
import { resolveUser } from '../../../server/session';
import { json } from '../../../server/site';
import { appleStoreOpen, readAppleTransaction } from '../../../server/store/apple';
import { licenseForApplePurchase } from '../../../server/store/license';
import { refuse } from '../../../server/upgrade';

export const prerender = false;

/**
 * A signed license file for a purchase made in a store app, bought just now
 * or restored. The app sends what the store signed; only that is believed.
 * Nobody need be logged in: whoever is gets the license on their account.
 */
export const POST: APIRoute = async ({ request }) => {
  const asked = StorePurchaseRequestSchema.safeParse(await request.json().catch(() => null));
  if (!asked.success) return refuse('invalid');
  if (!appleStoreOpen()) return refuse('no_store');
  if (!(await consumeRateLimit(await requestAddress(request), '/site/store-purchase/ip'))) return refuse('too_many');
  const purchase = await readAppleTransaction(asked.data.transaction);
  if (!purchase) return refuse('not_a_purchase');
  const outcome = await licenseForApplePurchase(purchase, await resolveUser(request));
  return 'file' in outcome ? json({ file: outcome.file }) : refuse(outcome.refusal);
};

import type { APIRoute } from 'astro';
import { StorePurchaseRequestSchema, type StorePurchaseRequest } from '@boombapbot/contracts';
import { requestAddress } from '../../../server/auth';
import { consumeRateLimit } from '../../../server/rate-limit';
import { resolveUser } from '../../../server/session';
import { json } from '../../../server/site';
import { appleStoreOpen, readAppleTransaction } from '../../../server/store/apple';
import { acknowledgeGooglePurchase, googleStoreOpen, readGooglePurchase, type GooglePurchase } from '../../../server/store/google';
import { licenseForStorePurchase } from '../../../server/store/license';
import type { StorePurchase } from '../../../server/store/purchase';
import { refuse } from '../../../server/upgrade';

export const prerender = false;

const storeOpen = (asked: StorePurchaseRequest) => (asked.store === 'apple' ? appleStoreOpen() : googleStoreOpen());

const vouchedFor = (asked: StorePurchaseRequest): Promise<StorePurchase | GooglePurchase | null> =>
  asked.store === 'apple' ? readAppleTransaction(asked.transaction) : readGooglePurchase(asked.token);

/**
 * A signed license file for a purchase made in a store app, bought just now
 * or restored. The app sends what its store gave it, and only what the
 * store says of that is believed: Apple by its signature, Google by being
 * asked. Nobody need be logged in: whoever is gets the license on their
 * account.
 */
export const POST: APIRoute = async ({ request }) => {
  const asked = StorePurchaseRequestSchema.safeParse(await request.json().catch(() => null));
  if (!asked.success) return refuse('invalid');
  if (!storeOpen(asked.data)) return refuse('no_store');
  if (!(await consumeRateLimit(await requestAddress(request), '/site/store-purchase/ip'))) return refuse('too_many');
  const purchase = await vouchedFor(asked.data);
  if (!purchase) return refuse('not_a_purchase');
  const outcome = await licenseForStorePurchase(purchase, await resolveUser(request));
  if (!('file' in outcome)) return refuse(outcome.refusal);
  if ('acknowledged' in purchase) await acknowledgeGooglePurchase(purchase);
  return json({ file: outcome.file });
};

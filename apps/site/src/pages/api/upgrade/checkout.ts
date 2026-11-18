import type { APIRoute } from 'astro';
import { UPGRADE_CURRENCY, UPGRADE_PRICE_CENTS } from '@boombapbot/contracts';
import { isUpgraded, resolveUser } from '../../../server/session';
import { getStripe } from '../../../server/shop/stripe';
import { json, originFor } from '../../../server/site';
import { refuse, upgradeMetadata, upgradeOpen } from '../../../server/upgrade';

export const prerender = false;

/** What Stripe's payment page and receipt call it. */
const PRODUCT_NAME = 'boombapbot upgrade';

/**
 * Starts a checkout for the upgrade and hands back the address of Stripe's
 * payment page. Nothing is recorded here: a license exists only once the
 * signed webhook says the money arrived. The price is the constant, never
 * anything from the request. No account is needed; with one, the license
 * goes straight onto it.
 */
export const POST: APIRoute = async ({ request }) => {
  const stripe = getStripe();
  if (!stripe || !upgradeOpen()) return refuse('closed');
  const buyer = await resolveUser(request);
  if (buyer && (await isUpgraded(buyer))) return refuse('already_upgraded');

  const origin = originFor(request);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: UPGRADE_CURRENCY,
          unit_amount: UPGRADE_PRICE_CENTS,
          product_data: { name: PRODUCT_NAME },
        },
      },
    ],
    customer_email: buyer?.email,
    client_reference_id: buyer?.uuid,
    metadata: upgradeMetadata(buyer),
    success_url: `${origin}/?upgrade=paid`,
    cancel_url: `${origin}/?upgrade=open`,
  });
  if (!session.url) throw new Error('Stripe made a checkout with no page to send the buyer to.');
  return json({ url: session.url });
};

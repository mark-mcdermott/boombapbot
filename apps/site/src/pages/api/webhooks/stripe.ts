import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { STRIPE_WEBHOOK_SECRET } from 'astro:env/server';
import { fulfil } from '../../../server/shop/fulfil';
import { getStripe } from '../../../server/shop/stripe';
import { json } from '../../../server/site';
import { isUpgrade, issueLicense, withdrawRefundedLicense } from '../../../server/upgrade';

export const prerender = false;

/** Stripe calls this when a checkout finishes or a payment is refunded. Only a request it signed is acted on. */
export const POST: APIRoute = async ({ request }) => {
  const stripe = getStripe();
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return json({ message: 'Payments are not set up.' }, 503);
  const signature = request.headers.get('stripe-signature');
  if (!signature) return json({ message: 'This request is not signed.' }, 400);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await request.text(), signature, STRIPE_WEBHOOK_SECRET);
  } catch {
    return json({ message: 'The signature does not match.' }, 400);
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    await (isUpgrade(session) ? issueLicense(session) : fulfil(session));
  }
  if (event.type === 'charge.refunded') await withdrawRefundedLicense(event.data.object);
  return json({ received: true });
};

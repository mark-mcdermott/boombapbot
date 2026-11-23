import { createHmac } from 'node:crypto';
import { STRIPE_WEBHOOK_SECRET } from './accounts-server';

type EventType = 'checkout.session.completed' | 'checkout.session.async_payment_succeeded';

/** What Stripe sends about a checkout, signed the way Stripe signs it. */
export function checkoutEvent(
  session: { id: string } & Record<string, unknown>,
  secret = STRIPE_WEBHOOK_SECRET,
  type: EventType = 'checkout.session.completed',
) {
  return signedEvent(type, { object: 'checkout.session', ...session }, session.id, secret);
}

/** What Stripe sends when a payment is refunded, in full (`refunded`) or in part. */
export function refundEvent(charge: { id: string; payment_intent: string; refunded: boolean }) {
  return signedEvent('charge.refunded', { object: 'charge', ...charge }, charge.id, STRIPE_WEBHOOK_SECRET);
}

function signedEvent(type: string, object: Record<string, unknown>, id: string, secret: string) {
  const payload = JSON.stringify({ id: `evt_${id}`, object: 'event', type, data: { object } });
  const time = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${time}.${payload}`).digest('hex');
  return { data: payload, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${time},v1=${signature}` } };
}

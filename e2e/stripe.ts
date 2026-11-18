import { createHmac } from 'node:crypto';
import { STRIPE_WEBHOOK_SECRET } from './accounts-server';

type EventType = 'checkout.session.completed' | 'checkout.session.async_payment_succeeded';

/** What Stripe sends about a checkout, signed the way Stripe signs it. */
export function checkoutEvent(
  session: { id: string } & Record<string, unknown>,
  secret = STRIPE_WEBHOOK_SECRET,
  type: EventType = 'checkout.session.completed',
) {
  const payload = JSON.stringify({
    id: `evt_${session.id}`,
    object: 'event',
    type,
    data: { object: { object: 'checkout.session', ...session } },
  });
  const time = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${time}.${payload}`).digest('hex');
  return { data: payload, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${time},v1=${signature}` } };
}

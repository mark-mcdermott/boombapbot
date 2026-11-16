import { STRIPE_API_URL, STRIPE_SECRET_KEY } from 'astro:env/server';
import Stripe from 'stripe';

let stripe: Stripe | null = null;

/** STRIPE_API_URL points the client somewhere other than Stripe. Only the tests set it. */
function apiHost(): Pick<Stripe.StripeConfig, 'host' | 'port' | 'protocol'> {
  if (!STRIPE_API_URL) return {};
  const url = new URL(STRIPE_API_URL);
  return { host: url.hostname, port: url.port, protocol: url.protocol === 'http:' ? 'http' : 'https' };
}

/** The Stripe client, or null while there is no key. Made on first use. */
export function getStripe(): Stripe | null {
  if (!STRIPE_SECRET_KEY) return null;
  stripe ??= new Stripe(STRIPE_SECRET_KEY, apiHost());
  return stripe;
}

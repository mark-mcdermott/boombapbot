import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { CheckoutRequestSchema, SHOP_CURRENCY, subtotalCents } from '@boombapbot/contracts';
import { getDb } from '../../../server/db';
import { order } from '../../../server/db/schema';
import { resolveUser } from '../../../server/session';
import { quoteShipping } from '../../../server/shop/printful';
import { readCartRequest } from '../../../server/shop/request';
import { getStripe } from '../../../server/shop/stripe';
import { json, originFor } from '../../../server/site';

export const prerender = false;

/**
 * Starts a checkout: records the order as pending and hands back the address
 * of Stripe's payment page. The prices come from the catalog and the
 * shipping from Printful, asked again here; nothing is taken from the
 * request but what is wanted and where it goes.
 */
export const POST: APIRoute = async ({ request }) => {
  const asked = await readCartRequest(request, CheckoutRequestSchema);
  if ('refusal' in asked) return asked.refusal;
  const stripe = getStripe();
  if (!stripe) return json({ message: 'The shop is not open yet.' }, 503);
  const { lines } = asked;
  const { address, shippingId } = asked.data;

  const shipping = (await quoteShipping(address, lines)).find((quote) => quote.id === shippingId);
  if (!shipping) return json({ message: 'The shipping prices changed. Choose one again.' }, 409);

  const buyer = await resolveUser(request);
  const subtotal = subtotalCents(lines);
  const db = await getDb();
  const [placed] = await db
    .insert(order)
    .values({
      userId: buyer?.id,
      email: buyer?.email,
      items: lines.map(({ product, variant, quantity }) => ({
        variantId: variant.id,
        name: product.name,
        label: variant.label,
        quantity,
        priceCents: variant.priceCents,
      })),
      subtotalCents: subtotal,
      shippingCents: shipping.cents,
      totalCents: subtotal + shipping.cents,
      shippingAddress: address,
      shippingMethod: shipping.id,
    })
    .returning({ id: order.id, uuid: order.uuid });
  if (!placed) throw new Error('The order could not be recorded.');

  const origin = originFor(request);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lines.map(({ product, variant, quantity }) => ({
      quantity,
      price_data: {
        currency: SHOP_CURRENCY,
        unit_amount: variant.priceCents,
        product_data: { name: `${product.name}, ${variant.label}` },
      },
    })),
    shipping_options: [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: shipping.label,
          fixed_amount: { amount: shipping.cents, currency: SHOP_CURRENCY },
        },
      },
    ],
    customer_email: buyer?.email,
    client_reference_id: placed.uuid,
    metadata: { order: placed.uuid },
    success_url: `${origin}/?order=${placed.uuid}`,
    cancel_url: `${origin}/?cart=open`,
  });
  if (!session.url) throw new Error('Stripe made a checkout with no page to send the buyer to.');

  await db.update(order).set({ stripeSessionId: session.id }).where(eq(order.id, placed.id));
  return json({ url: session.url });
};

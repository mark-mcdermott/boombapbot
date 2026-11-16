import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { order } from '../db/schema';
import { confirmPrintfulOrder, createPrintfulOrder } from './printful';

/**
 * Acts on a finished checkout: records the payment, then sends the order to
 * be printed. Stripe repeats a webhook that fails, so every step can be run
 * again without doing anything twice. An error here is meant to reach
 * Stripe: its retry is what gets a paid order printed after a bad moment.
 */
export async function fulfil(session: Stripe.Checkout.Session): Promise<void> {
  const uuid = session.metadata?.order;
  if (!uuid || session.payment_status !== 'paid') return;

  const db = await getDb();
  const [found] = await db.select().from(order).where(eq(order.uuid, uuid)).limit(1);
  if (!found) throw new Error(`Stripe took payment for order ${uuid}, which is not in the database.`);
  if (found.status !== 'pending' && found.status !== 'paid') return;

  const email = session.customer_details?.email ?? found.email;
  const paymentIntent = session.payment_intent;
  await db
    .update(order)
    .set({
      status: 'paid',
      email,
      stripePaymentIntentId: typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id,
      updatedAt: new Date(),
    })
    .where(eq(order.id, found.id));
  if (!email) throw new Error(`Order ${uuid} is paid but Stripe gave no email for the buyer.`);

  // The draft's id is kept before it is confirmed, so a retry confirms the
  // same draft instead of making a second one.
  let printfulOrderId = found.printfulOrderId;
  if (!printfulOrderId) {
    printfulOrderId = await createPrintfulOrder({
      uuid,
      email,
      address: found.shippingAddress,
      shippingMethod: found.shippingMethod,
      items: found.items,
      subtotalCents: found.subtotalCents,
      shippingCents: found.shippingCents,
      totalCents: found.totalCents,
    });
    await db.update(order).set({ printfulOrderId, updatedAt: new Date() }).where(eq(order.id, found.id));
  }
  await confirmPrintfulOrder(printfulOrderId);
  await db.update(order).set({ status: 'processing', updatedAt: new Date() }).where(eq(order.id, found.id));
}

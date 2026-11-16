import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { PRINTFUL_WEBHOOK_SECRET } from 'astro:env/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../../server/db';
import { order, type OrderStatus } from '../../../server/db/schema';
import { orderUuid } from '../../../server/shop/printful';
import { json } from '../../../server/site';

export const prerender = false;

const EventSchema = z.object({
  type: z.string(),
  data: z.object({
    order: z.object({ external_id: z.string().nullish() }).optional(),
    shipment: z.object({ tracking_number: z.string().nullish(), tracking_url: z.string().nullish() }).optional(),
  }),
});

/** What each of Printful's events means for an order here. */
const STATUS: Record<string, OrderStatus> = {
  package_shipped: 'shipped',
  order_failed: 'failed',
  order_canceled: 'canceled',
};

/** Printful does not sign its webhooks, so the address it is given carries a secret. */
function carriesSecret(request: Request): boolean {
  if (!PRINTFUL_WEBHOOK_SECRET) return false;
  const given = Buffer.from(new URL(request.url).searchParams.get('secret') ?? '');
  const expected = Buffer.from(PRINTFUL_WEBHOOK_SECRET);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Printful calls this as an order moves: shipped, failed or canceled. */
export const POST: APIRoute = async ({ request }) => {
  if (!carriesSecret(request)) return json({ message: 'Not allowed.' }, 403);
  const event = EventSchema.safeParse(await request.json().catch(() => null));
  if (!event.success) return json({ message: 'That event could not be read.' }, 400);

  const status = STATUS[event.data.type];
  const uuid = orderUuid(event.data.data.order?.external_id ?? '');
  if (status && uuid) {
    const shipment = event.data.data.shipment;
    const db = await getDb();
    await db
      .update(order)
      .set({
        status,
        trackingNumber: shipment?.tracking_number ?? undefined,
        trackingUrl: shipment?.tracking_url ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(order.uuid, uuid));
  }
  return json({ received: true });
};

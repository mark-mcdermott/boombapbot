import { PRINTFUL_API_KEY, PRINTFUL_API_URL, PRINTFUL_STORE_ID } from 'astro:env/server';
import type { Address, PricedLine, ShippingQuote } from '@boombapbot/contracts';
import { z } from 'zod';
import type { OrderItem } from '../db/schema';

const API = 'https://api.printful.com';
const CreatedSchema = z.object({ id: z.number() });
const RatesSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    rate: z.string(),
    minDeliveryDays: z.number().nullish(),
    maxDeliveryDays: z.number().nullish(),
  }),
);

export interface PrintfulOrderRequest {
  /** The order's uuid. */
  uuid: string;
  email: string;
  address: Address;
  /** One of the ids `quoteShipping` gave for this address. */
  shippingMethod: string;
  items: OrderItem[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
}

/** Whether there is a key to talk to Printful with. */
export function printfulReady(): boolean {
  return Boolean(PRINTFUL_API_KEY);
}

/** Printful knows an order by its uuid without the dashes, which fits its 32 characters. */
export function externalId(uuid: string): string {
  return uuid.replaceAll('-', '');
}

/** The uuid an external id was made from, or null if it is not one. */
export function orderUuid(external: string): string | null {
  const match = /^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/.exec(external);
  return match ? match.slice(1).join('-') : null;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

function recipient(address: Address) {
  return {
    name: address.name,
    address1: address.line1,
    address2: address.line2 ?? undefined,
    city: address.city,
    state_code: address.state ?? undefined,
    country_code: address.country,
    zip: address.postalCode,
  };
}

/** One POST to Printful. Returns its `result`, for the caller to read. */
async function post(path: string, body?: unknown): Promise<unknown> {
  if (!PRINTFUL_API_KEY) throw new Error('PRINTFUL_API_KEY is not set, so Printful cannot be asked anything.');
  const response = await fetch(`${PRINTFUL_API_URL || API}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${PRINTFUL_API_KEY}`,
      'content-type': 'application/json',
      ...(PRINTFUL_STORE_ID ? { 'x-pf-store-id': PRINTFUL_STORE_ID } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const answer: { result?: unknown; error?: { message?: string } } = await response.json();
  if (!response.ok) {
    throw new Error(`Printful refused ${path} (${response.status}): ${answer.error?.message ?? 'no reason given'}`);
  }
  return answer.result;
}

/** "Flat Rate (Estimated delivery: Nov 21-23)" is shown as "Flat Rate"; the days are shown separately. */
function methodLabel(name: string, id: string): string {
  return name.replace(/\s*\(.*$/, '').trim() || id;
}

/** What Printful would charge to send these lines to this address, cheapest first. */
export async function quoteShipping(address: Address, lines: PricedLine[]): Promise<ShippingQuote[]> {
  const rates = RatesSchema.parse(
    await post('/shipping/rates', {
      recipient: recipient(address),
      items: lines.map((line) => ({ variant_id: line.variant.catalogVariantId, quantity: line.quantity })),
      currency: 'USD',
    }),
  );
  return rates
    .map((rate) => ({
      id: rate.id,
      label: methodLabel(rate.name, rate.id),
      cents: Math.round(Number(rate.rate) * 100),
      minDays: rate.minDeliveryDays ?? 0,
      maxDays: rate.maxDeliveryDays ?? 0,
    }))
    .sort((a, b) => a.cents - b.cents);
}

/** Makes a draft order at Printful and returns its id there. Nothing is printed or charged yet. */
export async function createPrintfulOrder(order: PrintfulOrderRequest): Promise<string> {
  const created = CreatedSchema.parse(
    await post('/orders', {
      external_id: externalId(order.uuid),
      shipping: order.shippingMethod,
      recipient: { ...recipient(order.address), email: order.email },
      items: order.items.map((item) => ({ sync_variant_id: Number(item.variantId), quantity: item.quantity })),
      retail_costs: {
        subtotal: dollars(order.subtotalCents),
        shipping: dollars(order.shippingCents),
        total: dollars(order.totalCents),
      },
    }),
  );
  return String(created.id);
}

/** Tells Printful to go ahead. This is the step that charges the store's Printful account. */
export async function confirmPrintfulOrder(printfulOrderId: string): Promise<void> {
  await post(`/orders/${printfulOrderId}/confirm`);
}

import { addressProblem, priceCart, shopIsOpen, type Address, type PricedLine } from '@boombapbot/contracts';
import type { z } from 'zod';
import { json } from '../site';
import { getCatalog } from './catalog';
import { printfulReady } from './printful';
import { getStripe } from './stripe';

/** Whether an order could be taken right now: something to sell, and both services set up. */
export async function shopReady(): Promise<boolean> {
  return shopIsOpen(await getCatalog()) && getStripe() !== null && printfulReady();
}

interface CartRequest {
  items: Array<{ variantId: string; quantity: number }>;
  address: Address;
}

/**
 * Reads a cart and an address from a request and prices the cart from the
 * catalog. What comes back is either what the handler needs, or the answer
 * to give instead.
 */
export async function readCartRequest<Request_ extends CartRequest>(
  request: Request,
  schema: z.ZodType<Request_>,
): Promise<{ data: Request_; lines: PricedLine[] } | { refusal: Response }> {
  if (!(await shopReady())) return { refusal: json({ message: 'The shop is not open yet.' }, 503) };
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.items.length === 0) {
    return { refusal: json({ message: 'That cart or address could not be read.' }, 400) };
  }
  const catalog = await getCatalog();
  const lines = priceCart(catalog, parsed.data.items);
  if (lines.length < new Set(parsed.data.items.map((line) => line.variantId)).size) {
    return { refusal: json({ message: 'Something in that cart is no longer for sale.' }, 409) };
  }
  const problem = addressProblem(catalog, parsed.data.address);
  if (problem) return { refusal: json({ message: problem }, 400) };
  return { data: parsed.data, lines };
}

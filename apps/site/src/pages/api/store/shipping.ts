import type { APIRoute } from 'astro';
import { QuoteRequestSchema } from '@boombapbot/contracts';
import { quoteShipping } from '../../../server/shop/printful';
import { readCartRequest } from '../../../server/shop/request';
import { json } from '../../../server/site';

export const prerender = false;

/** What it costs to send this cart to this address, asked of Printful there and then. */
export const POST: APIRoute = async ({ request }) => {
  const asked = await readCartRequest(request, QuoteRequestSchema);
  if ('refusal' in asked) return asked.refusal;
  const quotes = await quoteShipping(asked.data.address, asked.lines);
  if (quotes.length === 0) return json({ message: 'Printful has no way to ship to that address.' }, 422);
  return json({ quotes });
};

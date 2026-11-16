import type { APIRoute } from 'astro';
import { getCatalog } from '../../../server/shop/catalog';
import { shopReady } from '../../../server/shop/request';
import { json } from '../../../server/site';

export const prerender = false;

/** The catalog, and whether an order can be taken right now. */
export const GET: APIRoute = async () => json({ ...(await getCatalog()), payments: await shopReady() });

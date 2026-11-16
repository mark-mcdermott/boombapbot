import type { APIRoute } from 'astro';
import { getAuth } from '../../../server/auth';

export const prerender = false;

/** Everything under /api/auth belongs to Better Auth. */
export const ALL: APIRoute = async ({ request }) => (await getAuth()).handler(request);

import type { APIRoute } from 'astro';
import { findAvatar } from '../../../server/avatars';

export const prerender = false;

const YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * An account's picture. A new picture has a new address, so this one's never
 * changes. It is sent as the kind of picture its bytes are and nothing a
 * browser would run.
 */
export const GET: APIRoute = async ({ params }) => {
  const found = await findAvatar(params.id);
  if (!found) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      'content-type': found.type,
      'cache-control': `public, max-age=${YEAR_SECONDS}, immutable`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
};

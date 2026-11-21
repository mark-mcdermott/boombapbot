import { defineMiddleware } from 'astro:middleware';
import { appOrigins } from './server/app-origins';

const API = '/api/';

/** What an app's page is told it may send and read. No cookie crosses: its session is a token in a header. */
function allowed(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-expose-headers': 'set-auth-token',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

/**
 * Lets the phone and desktop apps, whose pages are not served from this site, call its
 * API. Who is asking is still each handler's own question. A request from
 * the site itself, or from anywhere else, passes through untouched.
 */
export const onRequest = defineMiddleware(async ({ request, url }, next) => {
  const origin = request.headers.get('origin');
  if (!origin || !url.pathname.startsWith(API) || !appOrigins().includes(origin)) return next();
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: allowed(origin) });
  const answer = await next();
  const headers = new Headers(answer.headers);
  for (const [name, value] of Object.entries(allowed(origin))) headers.set(name, value);
  return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers });
});

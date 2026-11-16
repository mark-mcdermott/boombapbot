import { PUBLIC_SITE_URL } from 'astro:env/server';

/**
 * The address the site is served from, when it is fixed. In development it
 * is left to follow each request, so a production address in .env does not
 * send a laptop's sign-up or checkout to the live site.
 */
export function siteUrl(): string | undefined {
  return import.meta.env.DEV ? undefined : PUBLIC_SITE_URL || undefined;
}

/** The origin to build a link from: the fixed one, or the one this request came to. */
export function originFor(request: Request): string {
  return siteUrl() ?? new URL(request.url).origin;
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

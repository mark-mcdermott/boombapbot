import { AUTH_RATE_LIMIT } from 'astro:env/server';
import { sql } from 'drizzle-orm';
import { getDb } from './db';
import { rateLimit } from './db/schema';

/** On in production. Only the browser tests switch it off, with `AUTH_RATE_LIMIT=off`. */
export const RATE_LIMIT_ON = import.meta.env.PROD && AUTH_RATE_LIMIT !== 'off';

/** As Better Auth has a rule: at most `max` requests, `window` seconds apart at most. */
export interface RateRule {
  window: number;
  max: number;
}

/**
 * The site's own routes that are counted, beside Better Auth's. Each is
 * named like one of Better Auth's paths, and Better Auth is given these rules
 * too: it clears away any row older than the longest window it knows of, and
 * would otherwise clear these early. No Better Auth route has these paths.
 */
export const SITE_RATE_RULES = {
  '/site/key-by-email/address': { window: 60 * 60, max: 3 },
  '/site/key-by-email/ip': { window: 10 * 60, max: 5 },
  '/site/license-by-key/ip': { window: 10 * 60, max: 10 },
} as const satisfies Record<string, RateRule>;

export type SiteRateRule = keyof typeof SITE_RATE_RULES;

/**
 * Counts one request from `subject` to a site route, in Better Auth's
 * `rate_limits` table and the way Better Auth counts: a request more than a
 * window after the last one counted starts the count again, and one that
 * would go past `max` is refused and not counted. It is one statement, so
 * requests arriving together on different servers cannot all slip under it.
 * True when the request may go ahead.
 */
export async function consumeRateLimit(subject: string, route: SiteRateRule): Promise<boolean> {
  if (!RATE_LIMIT_ON) return true;
  const { window, max } = SITE_RATE_RULES[route];
  const now = Date.now();
  const windowMs = window * 1000;
  const expired = sql`${now} - ${rateLimit.lastRequest} >= ${windowMs}`;
  const db = await getDb();
  const counted = await db
    .insert(rateLimit)
    .values({ key: `${subject}|${route}`, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: { count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimit.count} + 1 END`, lastRequest: now },
      setWhere: sql`${expired} OR ${rateLimit.count} < ${max}`,
    })
    .returning({ count: rateLimit.count });
  return counted.length > 0;
}

import { AUTH_RATE_LIMIT, BETTER_AUTH_SECRET } from 'astro:env/server';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { getDb } from './db';
import * as schema from './db/schema';
import { LINK_LIFETIME_SECONDS, sendPasswordResetEmail, sendVerificationEmail } from './email';
import { isRecord, withPublicIds } from './public-ids';
import { siteUrl } from './site';

const DAY_SECONDS = 60 * 60 * 24;

/**
 * Made here, never taken from a request. Better Auth answers a sign-up for an
 * address that already has an account with a made-up user, and the default
 * gives that one a uuid too, so the two answers cannot be told apart.
 */
const publicId = {
  uuid: { type: 'string', required: false, input: false, defaultValue: () => crypto.randomUUID() },
} as const;

/**
 * Vercel's per-deploy hosts, so signing in works on a preview without
 * configuration. Production is covered by the base URL.
 */
function previewOrigins(): string[] {
  return [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].flatMap((host) => (host ? [`https://${host}`] : []));
}

/** Row ids stay on the server: whatever an endpoint answers, a record's `id` is its uuid. */
const hideRowIds = createAuthMiddleware(async (ctx) => {
  const answer = ctx.context.returned;
  if (answer instanceof Response || answer instanceof Error) return;
  const shaped = withPublicIds(answer);
  if (shaped !== answer && (isRecord(shaped) || Array.isArray(shaped))) return ctx.json(shaped);
});

async function build() {
  const secret = BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is not set. Make one with `openssl rand -base64 32`, a different one per environment.');
  }

  return betterAuth({
    appName: 'boombapbot',
    secret,
    // Where the links in an email point.
    baseURL: siteUrl(),
    trustedOrigins: previewOrigins(),
    database: drizzleAdapter(await getDb(), { provider: 'pg', schema }),

    // Deleting needs the password again. The database takes the account's
    // sessions, credential and saved beats with it, and unties its orders.
    user: { additionalFields: publicId, deleteUser: { enabled: true } },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: LINK_LIFETIME_SECONDS,
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmail(user.email, url);
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: LINK_LIFETIME_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationEmail(user.email, url);
      },
    },

    session: {
      expiresIn: 30 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
      additionalFields: publicId,
    },

    // On in production, as Better Auth has it. The browser tests run the
    // production build and sign up many times from one address, so they alone
    // switch it off.
    rateLimit: { enabled: import.meta.env.PROD && AUTH_RATE_LIMIT !== 'off' },

    advanced: { database: { generateId: 'serial' } },
    hooks: { after: hideRowIds },
  });
}

let auth: ReturnType<typeof build> | null = null;

/** Better Auth, built on first use for the reason `getDb` is. */
export function getAuth(): ReturnType<typeof build> {
  auth ??= build().catch((error: unknown) => {
    auth = null;
    throw error;
  });
  return auth;
}

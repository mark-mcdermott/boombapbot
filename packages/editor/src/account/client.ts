import { createAuthClient } from 'better-auth/react';

let client: ReturnType<typeof createAuthClient> | null = null;

/**
 * Talks to /api/auth on this site. The session lives in a cookie the server
 * sets. It is made when first asked for, not when this file is read: it
 * refuses a page whose address is not http or https, which a phone app's is
 * not, and that page never asks.
 */
export function authClient(): ReturnType<typeof createAuthClient> {
  client ??= createAuthClient();
  return client;
}

export const MIN_PASSWORD_LENGTH = 8;

export interface Failure {
  /** Better Auth's own code, where it gave one. */
  code?: string;
  status?: number;
  message?: string;
}

/** Better Auth's code for a log-in refused because the address is not confirmed yet. */
export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';
/** Its code for asking to confirm an address that already is. */
export const EMAIL_ALREADY_VERIFIED = 'EMAIL_ALREADY_VERIFIED';

/** No answer came at all: offline, or no server behind the page. */
export const UNREACHABLE = { code: 'UNREACHABLE' } as const satisfies Failure;

/**
 * Runs one call to the server and returns what went wrong, or null. The
 * client reports a refusal as `error` but throws when no answer came at all;
 * a form needs both as something it can show.
 */
export async function attempt(call: () => Promise<{ error: Failure | null }>): Promise<Failure | null> {
  try {
    return (await call()).error;
  } catch {
    return UNREACHABLE;
  }
}

const EXPLANATIONS: Record<string, string> = {
  UNREACHABLE: 'I could not reach the server. Check your connection and try again.',
  INVALID_EMAIL_OR_PASSWORD: 'Incorrect email or password.',
  INVALID_PASSWORD: 'That is not your password.',
  INVALID_EMAIL: 'That does not look like an email address.',
  PASSWORD_TOO_SHORT: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  PASSWORD_TOO_LONG: 'That password is too long. Use fewer than 128 characters.',
  INVALID_TOKEN: 'That link has expired or was already used. Ask for a new one.',
};

/** What to tell the person, in plain words. */
export function explain(failure: Failure): string {
  if (failure.status === 429) return 'Too many tries. Wait a minute, then try again.';
  const known = failure.code ? EXPLANATIONS[failure.code] : undefined;
  return known ?? failure.message ?? 'Something went wrong on my end. Try again in a minute.';
}

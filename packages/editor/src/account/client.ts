import { createAuthClient } from 'better-auth/react';

/** Where a shell keeps the token that says who is logged in. It answers at once: the shell reads its store before the page asks. */
export interface TokenStore {
  get(): string | null;
  set(token: string | null): void;
}

/** The site's server as a shell reaches it: from a page the site does not serve, which its cookie cannot follow. */
export interface ServerLink {
  /** The site's address, ending in a slash. */
  url: string;
  token: TokenStore;
}

/** The header Better Auth's bearer plug-in answers a log-in with. */
const TOKEN_HEADER = 'set-auth-token';
const ENDS_SESSION = /\/(sign-out|delete-user)$/;

let link: ServerLink | null = null;
let client: ReturnType<typeof createAuthClient> | null = null;

/**
 * Points every call to the server at the site, carrying a token in place of
 * the cookie. A shell calls it once, before anything asks who is logged in.
 */
export function linkServer(next: ServerLink): void {
  if (client) throw new Error('the server was already asked something, so it is too late to say where it is');
  link = next;
}

/** Whether the page is a shell reaching the site's server from outside it. */
export const isLinked = (): boolean => link !== null;

/** What keeps the beat on the machine, as the account's words name it: a shell's device, or the site's browser. */
export const draftKeeper = (): string => (link ? 'this device' : 'this browser');

/** Where that beat is kept, in the same words. */
export const draftKeptWhere = (): string => (link ? 'on this device' : 'in this browser');

/** What a request to the server carries to say who is asking, beyond the cookie a page of the site has. */
export function sessionHeaders(): Record<string, string> {
  const token = link?.token.get();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function linkedClient({ url, token }: ServerLink): ReturnType<typeof createAuthClient> {
  return createAuthClient({
    baseURL: new URL(url).origin,
    fetchOptions: {
      credentials: 'omit',
      auth: { type: 'Bearer', token: () => token.get() ?? undefined },
      onSuccess: ({ request, response }) => {
        const issued = response.headers.get(TOKEN_HEADER);
        if (issued) token.set(issued);
        else if (ENDS_SESSION.test(new URL(request.url).pathname)) token.set(null);
      },
    },
  });
}

/**
 * Talks to /api/auth on this site, where the session lives in a cookie the
 * server sets, or on the site a shell is linked to. It is made when first
 * asked for, not when this file is read: unlinked, it refuses a page whose
 * address is not http or https, which a phone app's is not, and such a page
 * links first or never asks.
 */
export function authClient(): ReturnType<typeof createAuthClient> {
  client ??= link ? linkedClient(link) : createAuthClient();
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
/** Its code for a log-in refused for the address or the password, which it does not tell apart. */
export const INVALID_EMAIL_OR_PASSWORD = 'INVALID_EMAIL_OR_PASSWORD';
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
  [INVALID_EMAIL_OR_PASSWORD]: 'Incorrect email or password.',
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

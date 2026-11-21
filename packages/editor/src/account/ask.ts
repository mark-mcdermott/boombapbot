import { UNREACHABLE, sessionHeaders, type Failure } from './client';

// One request to the site's server and what came of it. Every call
// made this way is started by a button in a modal; the machine never waits
// on one.

/** Why not: no answer came at all, or one did with this status and whatever the server said of it. */
export type Refusal<Said extends object> = typeof UNREACHABLE | { status: number } | ({ status: number } & Said);

export type Asked<Answer, Refused extends Failure = Failure> =
  | { ok: true; answer: Answer }
  | { ok: false; failure: Refused };

/** Anything that can check an answer's shape, as the contracts' schemas do. */
export interface Reader<Answer> {
  safeParse(value: unknown): { success: true; data: Answer } | { success: false };
}

/** For an answer whose arrival is all that matters. */
export const ANY_ANSWER: Reader<unknown> = { safeParse: (value) => ({ success: true, data: value }) };

/**
 * Sends a request and reads what came back: the answer in the shape `reader`
 * knows, or why not. A refusal is read with `refusal`; no answer at all is
 * `UNREACHABLE`, and an answer nothing can read is its status alone.
 */
export async function ask<Answer, Said extends object>(
  url: string,
  reader: Reader<Answer>,
  refusal: Reader<Said>,
  method = 'GET',
  body?: unknown,
): Promise<Asked<Answer, Refusal<Said>>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { ...sessionHeaders(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, failure: UNREACHABLE };
  }
  const { status } = response;
  const said: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const answer = reader.safeParse(said);
    return answer.success ? { ok: true, answer: answer.data } : { ok: false, failure: { status } };
  }
  const refused = refusal.safeParse(said);
  return { ok: false, failure: refused.success ? { status, ...refused.data } : { status } };
}

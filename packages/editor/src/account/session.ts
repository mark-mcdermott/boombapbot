/** Who is logged in, as far as the page needs to know. */
export interface SignedInAccount {
  email: string;
  /** The account's public id. */
  id: string;
}

/**
 * Reads the answer to "who is logged in". The server answers null when
 * nobody is, but anything can answer 200 at that address: a host with no
 * server behind it sends its own page, or an empty object. Whatever does not
 * name a user is nobody logged in, never an error.
 */
export function signedInAccount(answer: unknown): SignedInAccount | null {
  if (typeof answer !== 'object' || answer === null || !('user' in answer)) return null;
  const { user } = answer;
  if (typeof user !== 'object' || user === null || !('email' in user) || !('id' in user)) return null;
  const { email, id } = user;
  return typeof email === 'string' && typeof id === 'string' ? { email, id } : null;
}

import { isAvatarPath } from '@boombapbot/contracts';

/** Who is logged in, as far as the page needs to know. */
export interface SignedInAccount {
  email: string;
  /** The account's public id. */
  id: string;
  /** Where the site serves the picture the account uploaded, from the site's root, or null when it has none. */
  image: string | null;
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
  if (typeof email !== 'string' || typeof id !== 'string') return null;
  const image = 'image' in user && isAvatarPath(user.image) ? user.image : null;
  return { email, id, image };
}

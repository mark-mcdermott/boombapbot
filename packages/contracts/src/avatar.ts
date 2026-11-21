import { z } from 'zod';

// An account's picture. The page crops and shrinks it before sending it, so
// the server only ever keeps a small square, and checks the bytes itself.

/** The side of the square the page sends, in pixels. */
export const AVATAR_SIZE = 256;
/** The most a picture may weigh as sent. A square of AVATAR_SIZE weighs far less. */
export const MAX_AVATAR_BYTES = 96 * 1024;

export const AVATAR_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  signature.every((byte, index) => bytes[at + index] === byte);

const ASCII = (text: string) => [...text].map((character) => character.charCodeAt(0));

/**
 * What kind of picture the bytes are, read from the bytes and never from
 * what the sender says, or null when they are none the server keeps.
 */
export function avatarTypeOf(bytes: Uint8Array): AvatarType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, ...ASCII('PNG\r\n'), 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, ASCII('RIFF')) && startsWith(bytes, ASCII('WEBP'), 8)) return 'image/webp';
  return null;
}

/** Where the server serves pictures from, from the site's root. */
export const AVATAR_ROUTE = '/api/avatars/';
const AVATAR_PATH = /^\/api\/avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether an account's `image` is a picture this site serves. Nothing else is ever shown. */
export const isAvatarPath = (image: unknown): image is string => typeof image === 'string' && AVATAR_PATH.test(image);

/** Why the server did not keep a picture, in a word and in a sentence. */
export const AvatarRefusalSchema = z.object({
  code: z.enum(['signed_out', 'invalid', 'too_large']),
  message: z.string(),
});
export type AvatarRefusal = z.infer<typeof AvatarRefusalSchema>['code'];

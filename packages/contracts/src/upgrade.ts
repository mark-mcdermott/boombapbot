import { z } from 'zod';
import { SHOP_CURRENCY } from './shop';

// The one-time upgrade and its license key. The page and the server both read
// the price and the shape of a key from here, so they cannot disagree.

/** What the upgrade costs, once. */
export const UPGRADE_PRICE_CENTS = 500;
export const UPGRADE_CURRENCY = SHOP_CURRENCY;

/** Crockford's base 32: no I, L, O or U, so nothing in a key can be misread. */
export const LICENSE_KEY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const LICENSE_KEY_PREFIX = 'BOOM';
const GROUPS = 4;
const GROUP_LENGTH = 5;
/** The random characters in a key: a hundred bits. */
export const LICENSE_KEY_LENGTH = GROUPS * GROUP_LENGTH;

/** A key as it is stored, emailed and shown: BOOM-XXXXX-XXXXX-XXXXX-XXXXX. */
export const LICENSE_KEY_PATTERN = new RegExp(
  `^${LICENSE_KEY_PREFIX}(-[${LICENSE_KEY_ALPHABET}]{${GROUP_LENGTH}}){${GROUPS}}$`,
);

function grouped(characters: string): string {
  const groups = characters.match(new RegExp(`.{${GROUP_LENGTH}}`, 'g')) ?? [];
  return [LICENSE_KEY_PREFIX, ...groups].join('-');
}

/**
 * The key those random bytes spell, one character to a byte. The alphabet
 * has 32 letters and a byte 256 values, so every letter is as likely as any
 * other. Only the server makes keys; it hands this bytes from its own
 * random source.
 */
export function licenseKeyFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== LICENSE_KEY_LENGTH) {
    throw new Error(`A license key is made from ${LICENSE_KEY_LENGTH} random bytes, not ${bytes.length}.`);
  }
  return grouped(Array.from(bytes, (byte) => LICENSE_KEY_ALPHABET[byte % LICENSE_KEY_ALPHABET.length]).join(''));
}

/** What a hand types for a character the alphabet leaves out. */
const LOOK_ALIKES: Record<string, string> = { O: '0', I: '1', L: '1' };
const TYPED_PREFIX = /^B[O0]{2}M/;

/**
 * A key as somebody typed or pasted it, put back into the one form it is
 * stored in: any case, with or without its dashes, spaces or prefix, and
 * with a letter O, I or L read as the digit it was. Null when it cannot be
 * a key at all.
 */
export function normalizeLicenseKey(typed: string): string | null {
  const packed = typed.toUpperCase().replace(/[\s-]/g, '');
  const prefixed = packed.length === LICENSE_KEY_PREFIX.length + LICENSE_KEY_LENGTH;
  const body = prefixed ? packed.replace(TYPED_PREFIX, '') : packed;
  if (body.length !== LICENSE_KEY_LENGTH) return null;
  const key = grouped(body.replace(/[OIL]/g, (letter) => LOOK_ALIKES[letter] ?? letter));
  return LICENSE_KEY_PATTERN.test(key) ? key : null;
}

/** What the server answers when asked about the upgrade. */
export const UpgradeAnswerSchema = z.object({
  /** Whether it can be bought right now. */
  open: z.boolean(),
  priceCents: z.number().int().positive(),
  currency: z.string(),
  /** Whether the account that asked has it. Always false with nobody logged in. */
  upgraded: z.boolean(),
});
export type UpgradeAnswer = z.infer<typeof UpgradeAnswerSchema>;

/** A license as its account sees it. Its `id` is the row's uuid. */
export const LicenseSchema = z.object({
  id: z.uuid(),
  key: z.string().regex(LICENSE_KEY_PATTERN),
  issuedAt: z.iso.datetime(),
});
export type License = z.infer<typeof LicenseSchema>;

export const LicenseAnswerSchema = z.object({ license: LicenseSchema });

/** Puts a key that was bought without an account onto the account that asks. */
export const RedeemKeyRequestSchema = z.object({ key: z.string().min(1).max(80) });

/** Asks for the keys bought with an address to be emailed to it again. */
export const KeyReminderRequestSchema = z.object({ email: z.email().max(320) });

/**
 * Why the server refused, for the page to act on. `closed`: it is not for
 * sale. `signed_out`: nobody is logged in. `already_upgraded`: the account
 * has a license. `no_license`: it has none. `unknown_key`: no such key.
 * `key_taken`: the key is on another account. `invalid`: the request could
 * not be read. `too_many`: the same thing was asked too often lately.
 * `withdrawn`: the license was refunded or taken back, and gives out no more
 * license files. `no_signing_key`: the server has no key to sign a license
 * file with. The message is for the person.
 */
export const UPGRADE_REFUSALS = [
  'closed',
  'signed_out',
  'already_upgraded',
  'no_license',
  'unknown_key',
  'key_taken',
  'invalid',
  'too_many',
  'withdrawn',
  'no_signing_key',
] as const;
export type UpgradeRefusal = (typeof UPGRADE_REFUSALS)[number];

export const UpgradeRefusalSchema = z.object({ code: z.enum(UPGRADE_REFUSALS), message: z.string() });

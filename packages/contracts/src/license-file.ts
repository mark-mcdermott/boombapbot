import { ed25519 } from '@noble/curves/ed25519.js';
import { z } from 'zod';
import { RedeemKeyRequestSchema } from './upgrade';

// The signed license file: what the server hands a buyer so that a program
// can tell, with no server to ask, that the upgrade was paid for. The format
// is written down in docs/license-file.md, which the plugin's C++ follows
// too; change the two together.

/** The first of a file's three parts. It is signed with the payload, so a signature made for anything else is not one for a license. */
export const LICENSE_FILE_PREFIX = 'boombapbot-license';
export const LICENSE_FILE_VERSION = 1;
/** Everything the one-time upgrade pays for. A program ignores a name it does not know. */
export const UPGRADE_UNLOCK = 'upgrade';
/** No license file is near this long. Anything longer is not read at all. */
export const LICENSE_FILE_MAX_LENGTH = 2048;

/**
 * The public half of the key the server signs with, as base64url of its 32
 * bytes. Empty until the owner has made the pair (`pnpm license:keypair`);
 * until then no file is accepted against it.
 */
export const LICENSE_PUBLIC_KEY = '';

const SEPARATOR = '.';
const PUBLIC_KEY_BYTES = 32;
const SIGNATURE_BYTES = 64;

/** What a license file says, once its signature has been checked. */
export const LicenseFilePayloadSchema = z.object({
  version: z.literal(LICENSE_FILE_VERSION),
  /** The license's public id, the one the server knows it by. */
  licenseId: z.uuid(),
  /** When this file was made. A file does not run out. */
  issuedAt: z.iso.datetime(),
  unlocks: z.array(z.string().min(1)).min(1),
});
export type LicenseFilePayload = z.infer<typeof LicenseFilePayloadSchema>;

/** Asks for a license file with a key alone, no account. */
export const LicenseFileRequestSchema = RedeemKeyRequestSchema;

/** The server's answer: the file's whole text, to be kept as it is. */
export const LicenseFileAnswerSchema = z.object({ file: z.string().min(1).max(LICENSE_FILE_MAX_LENGTH) });
export type LicenseFileAnswer = z.infer<typeof LicenseFileAnswerSchema>;

/**
 * Why a file was refused. `malformed`: it is not a license file, or not a
 * whole one. `bad_signature`: it was changed, or signed with another key.
 * `unsupported_version`: it is properly signed, in a format this program
 * does not read.
 */
export type LicenseFileRefusal = 'malformed' | 'bad_signature' | 'unsupported_version';

export type LicenseFileCheck =
  | { valid: true; licenseId: string; issuedAt: string; unlocks: readonly string[] }
  | { valid: false; reason: LicenseFileRefusal };

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function toBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The bytes that text spells, or null unless it is exactly how `toBase64Url` would write them. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null;
  const bytes = Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
  return toBase64Url(bytes) === text ? bytes : null;
}

/** The public key that goes with a signing key, in the form `LICENSE_PUBLIC_KEY` holds. */
export function licensePublicKey(signingKey: Uint8Array): string {
  return toBase64Url(ed25519.getPublicKey(signingKey));
}

/**
 * The text of a license file for that payload. Only the server signs: the
 * signing key is its secret, and is 32 bytes.
 */
export function signLicenseFile(payload: LicenseFilePayload, signingKey: Uint8Array): string {
  const signed = [LICENSE_FILE_PREFIX, toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))].join(SEPARATOR);
  const signature = ed25519.sign(new TextEncoder().encode(signed), signingKey);
  return [signed, toBase64Url(signature)].join(SEPARATOR);
}

const refused = (reason: LicenseFileRefusal): LicenseFileCheck => ({ valid: false, reason });

function readPayload(encoded: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encoded));
  } catch {
    return undefined;
  }
}

/**
 * Whether that text is a license file signed by the holder of `publicKey`,
 * and what it unlocks. It asks no server. Nothing in the file is believed
 * until the signature over it has held, and space around the text, such as
 * the line ending an editor adds, is not part of it.
 */
export function verifyLicenseFile(text: string, publicKey: string = LICENSE_PUBLIC_KEY): LicenseFileCheck {
  if (text.length > LICENSE_FILE_MAX_LENGTH) return refused('malformed');
  const parts = text.trim().split(SEPARATOR);
  const [prefix, encodedPayload, encodedSignature] = parts;
  if (parts.length !== 3 || prefix !== LICENSE_FILE_PREFIX || !encodedPayload || !encodedSignature) {
    return refused('malformed');
  }
  const payloadBytes = fromBase64Url(encodedPayload);
  const signature = fromBase64Url(encodedSignature);
  if (!payloadBytes || signature?.length !== SIGNATURE_BYTES) return refused('malformed');

  const key = fromBase64Url(publicKey);
  if (key?.length !== PUBLIC_KEY_BYTES) return refused('bad_signature');
  const signed = new TextEncoder().encode([prefix, encodedPayload].join(SEPARATOR));
  if (!ed25519.verify(signature, signed, key, { zip215: false })) return refused('bad_signature');

  const payload = readPayload(payloadBytes);
  const version = z.object({ version: z.number() }).safeParse(payload);
  if (version.success && version.data.version !== LICENSE_FILE_VERSION) return refused('unsupported_version');
  const read = LicenseFilePayloadSchema.safeParse(payload);
  if (!read.success) return refused('malformed');
  const { licenseId, issuedAt, unlocks } = read.data;
  return { valid: true, licenseId, issuedAt, unlocks };
}

/** Whether a checked file pays for the upgrade. */
export function unlocksUpgrade(check: LicenseFileCheck): boolean {
  return check.valid && check.unlocks.includes(UPGRADE_UNLOCK);
}

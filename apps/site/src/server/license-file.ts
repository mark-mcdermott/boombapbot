import { LICENSE_SIGNING_KEY } from 'astro:env/server';
import {
  LICENSE_FILE_VERSION,
  UPGRADE_UNLOCK,
  fromBase64Url,
  normalizeLicenseKey,
  signLicenseFile,
  type LicenseFilePayload,
  type UpgradeRefusal,
} from '@boombapbot/contracts';
import { eq, type SQL } from 'drizzle-orm';
import { getDb } from './db';
import { license } from './db/schema';
import type { SignedInUser } from './session';

// The signed license file a program keeps to know, with no server, that the
// upgrade was paid for. Its format is in docs/license-file.md.

export type LicenseFileOutcome = { file: string } | { refusal: UpgradeRefusal };

const SIGNING_KEY_BYTES = 32;

/** The server's signing key, or null when none is set. One that is set and cannot be a key is an error, not a closed door. */
function signingKey(): Uint8Array | null {
  if (!LICENSE_SIGNING_KEY) return null;
  const key = fromBase64Url(LICENSE_SIGNING_KEY.trim());
  if (key?.length !== SIGNING_KEY_BYTES) {
    throw new Error('LICENSE_SIGNING_KEY is not 32 bytes in base64url. Make a pair with `pnpm license:keypair`.');
  }
  return key;
}

/**
 * A freshly signed file for the license that matches, or why not. A
 * withdrawn license gives out none; the files it gave out before still
 * verify, since a file carries no end date and no program asks the server.
 */
async function fileFor(match: SQL, missing: UpgradeRefusal): Promise<LicenseFileOutcome> {
  const key = signingKey();
  if (!key) return { refusal: 'no_signing_key' };
  const db = await getDb();
  const [held] = await db
    .select({ uuid: license.uuid, withdrawnAt: license.withdrawnAt })
    .from(license)
    .where(match)
    .limit(1);
  if (!held) return { refusal: missing };
  if (held.withdrawnAt) return { refusal: 'withdrawn' };
  const payload: LicenseFilePayload = {
    version: LICENSE_FILE_VERSION,
    licenseId: held.uuid,
    issuedAt: new Date().toISOString(),
    unlocks: [UPGRADE_UNLOCK],
  };
  return { file: signLicenseFile(payload, key) };
}

/** The file for a typed key, whoever holds it: a key alone is enough, and it stays on whatever account it is on. */
export async function licenseFileForKey(typed: string): Promise<LicenseFileOutcome> {
  const key = normalizeLicenseKey(typed);
  return key ? fileFor(eq(license.key, key), 'unknown_key') : { refusal: 'unknown_key' };
}

/** The file for the license on an account. */
export function licenseFileForAccount(account: SignedInUser): Promise<LicenseFileOutcome> {
  return fileFor(eq(license.userId, account.id), 'no_license');
}

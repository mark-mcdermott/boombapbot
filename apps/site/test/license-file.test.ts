import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { LICENSE_KEY_LENGTH, licenseKeyFromBytes, verifyLicenseFile } from '@boombapbot/contracts';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/server/db';
import { license, user } from '../src/server/db/schema';
import { licenseFileForAccount, licenseFileForKey } from '../src/server/license-file';
import type { SignedInUser } from '../src/server/session';
import { setLicenseSigningKey } from './astro-env';

// The database is the committed migrations run in memory, so these also show
// that the migration adding `withdrawn_at` applies and matches the schema.

/** A pair made for this run. Its signing half is never written anywhere. */
function throwawayPair(): { signingKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signingKey = privateKey.export({ format: 'jwk' }).d;
  const verifyingKey = publicKey.export({ format: 'jwk' }).x;
  if (!signingKey || !verifyingKey) throw new Error('Node made an Ed25519 pair without its key material.');
  return { signingKey, publicKey: verifyingKey };
}

const pair = throwawayPair();
const unique = () => randomBytes(8).toString('hex');

async function bought(owner: SignedInUser | null = null): Promise<{ key: string; uuid: string }> {
  const db = await getDb();
  const [made] = await db
    .insert(license)
    .values({
      userId: owner?.id ?? null,
      email: owner?.email ?? `${unique()}@example.com`,
      key: licenseKeyFromBytes(randomBytes(LICENSE_KEY_LENGTH)),
      stripeSessionId: `cs_test_${unique()}`,
    })
    .returning({ key: license.key, uuid: license.uuid });
  if (!made) throw new Error('The license was not recorded.');
  return made;
}

async function account(): Promise<SignedInUser> {
  const db = await getDb();
  const [made] = await db
    .insert(user)
    .values({ name: 'Buyer', email: `${unique()}@example.com` })
    .returning({ id: user.id, uuid: user.uuid, email: user.email });
  if (!made) throw new Error('The account was not recorded.');
  return made;
}

async function withdraw(uuid: string): Promise<void> {
  const db = await getDb();
  await db.update(license).set({ withdrawnAt: new Date() }).where(eq(license.uuid, uuid));
}

function fileOf(outcome: Awaited<ReturnType<typeof licenseFileForKey>>): string {
  if (!('file' in outcome)) throw new Error(`No license file was given: ${outcome.refusal}.`);
  return outcome.file;
}

beforeEach(() => setLicenseSigningKey(pair.signingKey));

describe('a license file for a key alone', () => {
  it('is signed by the server, names the license and unlocks the upgrade', async () => {
    const { key, uuid } = await bought();
    const before = Date.now();
    const check = verifyLicenseFile(fileOf(await licenseFileForKey(key)), pair.publicKey);
    expect(check).toMatchObject({ valid: true, licenseId: uuid, unlocks: ['upgrade'] });
    if (!check.valid) return;
    expect(Date.parse(check.issuedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(check.issuedAt)).toBeLessThanOrEqual(Date.now());
  });

  it('is given for the key however it was typed, and whether or not the key is on an account', async () => {
    const owner = await account();
    const { key, uuid } = await bought(owner);
    const typed = `  ${key.toLowerCase().replace(/-/g, ' ')} `;
    expect(verifyLicenseFile(fileOf(await licenseFileForKey(typed)), pair.publicKey)).toMatchObject({ licenseId: uuid });
  });

  it('is given as often as it is asked for, since there is no limit on devices', async () => {
    const { key, uuid } = await bought();
    for (let device = 0; device < 3; device += 1) {
      expect(verifyLicenseFile(fileOf(await licenseFileForKey(key)), pair.publicKey)).toMatchObject({ licenseId: uuid });
    }
  });

  it('is refused for a key nobody bought, and for what cannot be a key', async () => {
    await bought();
    for (const typed of [licenseKeyFromBytes(randomBytes(LICENSE_KEY_LENGTH)), 'BOOM', '', "' OR 1=1 --"]) {
      expect(await licenseFileForKey(typed), typed).toEqual({ refusal: 'unknown_key' });
    }
  });
});

describe('a license file for an account', () => {
  it('is the file of the license on that account', async () => {
    const owner = await account();
    const { uuid } = await bought(owner);
    await bought(await account());
    const check = verifyLicenseFile(fileOf(await licenseFileForAccount(owner)), pair.publicKey);
    expect(check).toMatchObject({ valid: true, licenseId: uuid, unlocks: ['upgrade'] });
  });

  it('is refused for an account that has not upgraded', async () => {
    expect(await licenseFileForAccount(await account())).toEqual({ refusal: 'no_license' });
  });
});

describe('a withdrawn license', () => {
  it('gives out no more files, by its key or to its account', async () => {
    const owner = await account();
    const { key, uuid } = await bought(owner);
    const other = await bought();
    await withdraw(uuid);
    expect(await licenseFileForKey(key)).toEqual({ refusal: 'withdrawn' });
    expect(await licenseFileForAccount(owner)).toEqual({ refusal: 'withdrawn' });
    expect('file' in (await licenseFileForKey(other.key))).toBe(true);
  });

  it('leaves the files it gave out before as good as they were', async () => {
    const { key, uuid } = await bought();
    const issued = fileOf(await licenseFileForKey(key));
    await withdraw(uuid);
    expect(verifyLicenseFile(issued, pair.publicKey)).toMatchObject({ valid: true, licenseId: uuid });
  });
});

describe('the signing key', () => {
  it('is the only key whose files verify', async () => {
    const { key } = await bought();
    const file = fileOf(await licenseFileForKey(key));
    expect(verifyLicenseFile(file, throwawayPair().publicKey)).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('gives out nothing while it is not set, for a real key or a made-up one alike', async () => {
    const { key } = await bought();
    for (const unset of [undefined, '']) {
      setLicenseSigningKey(unset);
      expect(await licenseFileForKey(key)).toEqual({ refusal: 'no_signing_key' });
      expect(await licenseFileForKey(licenseKeyFromBytes(randomBytes(LICENSE_KEY_LENGTH)))).toEqual({ refusal: 'no_signing_key' });
      expect(await licenseFileForAccount(await account())).toEqual({ refusal: 'no_signing_key' });
    }
  });

  it('is an error, not a quiet refusal, when it is set to something that cannot be a key', async () => {
    const { key } = await bought();
    for (const wrong of ['not a key', pair.signingKey.slice(0, -4), `${pair.signingKey}AAAA`]) {
      setLicenseSigningKey(wrong);
      await expect(licenseFileForKey(key), wrong.length.toString()).rejects.toThrow(/LICENSE_SIGNING_KEY/);
    }
  });
});

import { generateKeyPairSync } from 'node:crypto';
import { LICENSE_PUBLIC_KEY, signLicenseFile, type LicenseFilePayload } from '@boombapbot/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KeyValueStorage } from '../src/state/draft-storage';
import { DeviceLicense, LICENSE_FILE_KEY, fetchDeviceLicense } from '../src/upgrade/device-license';

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  failWrites = false;
  failReads = false;
  getItem(key: string): string | null {
    if (this.failReads) throw new Error('storage is blocked');
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded');
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** A pair made for this run and thrown away with it. */
function throwawayPair(): { signingKey: Uint8Array; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'jwk' }).d;
  const x = publicKey.export({ format: 'jwk' }).x;
  if (!seed || !x) throw new Error('Node made an Ed25519 pair without its key material.');
  return { signingKey: new Uint8Array(Buffer.from(seed, 'base64url')), publicKey: x };
}

const pair = throwawayPair();
const PAYLOAD: LicenseFilePayload = {
  version: 1,
  licenseId: '3f2b8c1e-9a47-4d0b-b6e2-5c81f0a7d394',
  issuedAt: '2026-11-23T12:00:00.000Z',
  unlocks: ['upgrade'],
};
const FILE = signLicenseFile(PAYLOAD, pair.signingKey);
const SITE = 'https://site.example/';

const holding = (file: string | null, storage = new MemoryStorage()) => {
  if (file !== null) storage.items.set(LICENSE_FILE_KEY, file);
  return { storage, license: new DeviceLicense(storage, pair.publicKey) };
};

function answering(status: number, said: unknown) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url);
    return new Response(JSON.stringify(said), { status });
  });
  return asked;
}

afterEach(() => vi.unstubAllGlobals());

describe('the license file a device holds', () => {
  it('upgrades the device from the moment it is kept, and after the page is opened again', () => {
    const { storage, license } = holding(null);
    expect(license.upgraded).toBe(false);
    expect(license.keep(FILE)).toBe(true);
    expect(license.upgraded).toBe(true);
    expect(storage.items.get(LICENSE_FILE_KEY)).toBe(FILE);
    expect(new DeviceLicense(storage, pair.publicKey).upgraded).toBe(true);
  });

  it('is checked on the device, against the key built into the program', () => {
    expect(new DeviceLicense(holding(FILE).storage).upgraded).toBe(false);
    expect(LICENSE_PUBLIC_KEY).not.toBe(pair.publicKey);
  });

  it('upgrades nothing when it was changed, cut short, signed by somebody else or says nothing of the upgrade', () => {
    const other = throwawayPair();
    const forgeries = [
      `${FILE.slice(0, 40)}A${FILE.slice(41)}`,
      FILE.slice(0, -8),
      signLicenseFile(PAYLOAD, other.signingKey),
      signLicenseFile({ ...PAYLOAD, unlocks: ['something-else'] }, pair.signingKey),
      'true',
      '',
    ];
    for (const forged of forgeries) {
      expect(holding(forged).license.upgraded, forged.slice(0, 50)).toBe(false);
      const { storage, license } = holding(null);
      expect(license.keep(forged), forged.slice(0, 50)).toBe(false);
      expect(license.upgraded).toBe(false);
      expect(storage.items.has(LICENSE_FILE_KEY)).toBe(false);
    }
  });

  it('is not lost to a bad file that comes after it', () => {
    const { storage, license } = holding(FILE);
    expect(license.keep(FILE.slice(0, -8))).toBe(false);
    expect(license.upgraded).toBe(true);
    expect(storage.items.get(LICENSE_FILE_KEY)).toBe(FILE);
  });

  it('holds for the visit where storage cannot be written, and is none where it cannot be read', () => {
    const blocked = new MemoryStorage();
    blocked.failWrites = true;
    const license = new DeviceLicense(blocked, pair.publicKey);
    expect(license.keep(FILE)).toBe(true);
    expect(license.upgraded).toBe(true);

    const unreadable = holding(FILE).storage;
    unreadable.failReads = true;
    expect(new DeviceLicense(unreadable, pair.publicKey).upgraded).toBe(false);
    expect(new DeviceLicense(null, pair.publicKey).upgraded).toBe(false);
  });

  it('tells whoever is listening once, when the device becomes upgraded', () => {
    const { license } = holding(null);
    const heard = vi.fn();
    const stop = license.subscribe(heard);
    license.keep('not a file');
    expect(heard).not.toHaveBeenCalled();
    license.keep(FILE);
    license.keep(FILE);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    const quiet = holding(null).license;
    const unheard = vi.fn();
    quiet.subscribe(unheard)();
    quiet.keep(FILE);
    expect(unheard).not.toHaveBeenCalled();
  });
});

describe('fetching the license file of the account that is logged in', () => {
  it('keeps the file the server gives', async () => {
    const asked = answering(200, { file: FILE });
    const { license } = holding(null);
    await fetchDeviceLicense(SITE, license);
    expect(asked).toEqual([`${SITE}api/upgrade/license`]);
    expect(license.upgraded).toBe(true);
  });

  it('asks nothing of the server when the device already holds a good one', async () => {
    const asked = answering(200, { file: FILE });
    await fetchDeviceLicense(SITE, holding(FILE).license);
    expect(asked).toEqual([]);
  });

  it('leaves the device as it was when the account has not upgraded, or the server gives something else', async () => {
    for (const [status, said] of [
      [404, { code: 'no_license', message: 'This account has no license key.' }],
      [403, { code: 'withdrawn', message: 'That license was withdrawn.' }],
      [200, { file: signLicenseFile(PAYLOAD, throwawayPair().signingKey) }],
      [200, { license: FILE }],
      [200, '<html>'],
    ] as const) {
      answering(status, said);
      const { license } = holding(null);
      await fetchDeviceLicense(SITE, license);
      expect(license.upgraded, JSON.stringify(said)).toBe(false);
    }
  });

  it('leaves the device as it was when no server answers', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const { license } = holding(null);
    await expect(fetchDeviceLicense(SITE, license)).resolves.toBeUndefined();
    expect(license.upgraded).toBe(false);
  });
});

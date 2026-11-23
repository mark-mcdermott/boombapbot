import { generateKeyPairSync } from 'node:crypto';
import { LICENSE_PUBLIC_KEY, signLicenseFile, type LicenseFilePayload } from '@boombapbot/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KeyValueStorage } from '../src/state/draft-storage';
import {
  DeviceLicense,
  LICENSE_FILE_KEY,
  LICENSE_SOURCE_KEY,
  fetchDeviceLicense,
  unlockWithKey,
  type LicenseSource,
} from '../src/upgrade/device-license';

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

const holding = (file: string | null, source?: LicenseSource, storage = new MemoryStorage()) => {
  if (file !== null) storage.items.set(LICENSE_FILE_KEY, file);
  if (source) storage.items.set(LICENSE_SOURCE_KEY, source);
  return { storage, license: new DeviceLicense(storage, pair.publicKey) };
};

function answering(status: number, said: unknown) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    asked.push(init.method === 'POST' ? `POST ${url} ${String(init.body)}` : url);
    return new Response(JSON.stringify(said), { status });
  });
  return asked;
}

afterEach(() => vi.unstubAllGlobals());

describe('the license file a device holds', () => {
  it('upgrades the device from the moment it is kept, and after the page is opened again', () => {
    const { storage, license } = holding(null);
    expect(license.upgraded).toBe(false);
    expect(license.keep(FILE, 'account')).toBe(true);
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
      expect(license.keep(forged, 'account'), forged.slice(0, 50)).toBe(false);
      expect(license.upgraded).toBe(false);
      expect(storage.items.has(LICENSE_FILE_KEY)).toBe(false);
    }
  });

  it('is not lost to a bad file that comes after it', () => {
    const { storage, license } = holding(FILE);
    expect(license.keep(FILE.slice(0, -8), 'account')).toBe(false);
    expect(license.upgraded).toBe(true);
    expect(storage.items.get(LICENSE_FILE_KEY)).toBe(FILE);
  });

  it('holds for the visit where storage cannot be written, and is none where it cannot be read', () => {
    const blocked = new MemoryStorage();
    blocked.failWrites = true;
    const license = new DeviceLicense(blocked, pair.publicKey);
    expect(license.keep(FILE, 'account')).toBe(true);
    expect(license.upgraded).toBe(true);

    const unreadable = holding(FILE).storage;
    unreadable.failReads = true;
    expect(new DeviceLicense(unreadable, pair.publicKey).upgraded).toBe(false);
    expect(new DeviceLicense(null, pair.publicKey).upgraded).toBe(false);
  });

  it('is locked again when nobody is logged in, if an account unlocked it', () => {
    const { storage, license } = holding(null);
    license.keep(FILE, 'account');
    expect(license.source).toBe('account');
    license.removeKey();
    expect(license.upgraded).toBe(true);
    license.loggedOut();
    expect(license.upgraded).toBe(false);
    expect(license.source).toBeNull();
    expect(storage.items.size).toBe(0);
    expect(new DeviceLicense(storage, pair.publicKey).upgraded).toBe(false);
  });

  it('stays unlocked with nobody logged in, if a typed key unlocked it, until the key is removed', () => {
    const { storage, license } = holding(null);
    license.keep(FILE, 'key');
    license.loggedOut();
    expect(license.source).toBe('key');
    expect(new DeviceLicense(storage, pair.publicKey).source).toBe('key');
    license.removeKey();
    expect(license.upgraded).toBe(false);
    expect(storage.items.size).toBe(0);
  });

  it('stays a key\u2019s when an account logs in after, and becomes a key\u2019s when one is typed after', () => {
    const typedFirst = holding(null).license;
    typedFirst.keep(FILE, 'key');
    typedFirst.keep(FILE, 'account');
    typedFirst.loggedOut();
    expect(typedFirst.source).toBe('key');

    const loggedInFirst = holding(null).license;
    loggedInFirst.keep(FILE, 'account');
    loggedInFirst.keep(FILE, 'key');
    loggedInFirst.loggedOut();
    expect(loggedInFirst.source).toBe('key');
  });

  it('takes a file kept before it was said how for an account\u2019s, which a log-out locks', () => {
    for (const source of [undefined, 'somebody' as LicenseSource]) {
      const { license } = holding(FILE, source);
      expect(license.source).toBe('account');
      license.loggedOut();
      expect(license.upgraded).toBe(false);
    }
  });

  it('is locked for the visit even where storage will not let the file go', () => {
    const { storage, license } = holding(FILE, 'account');
    storage.removeItem = () => {
      throw new Error('storage is blocked');
    };
    license.loggedOut();
    expect(license.upgraded).toBe(false);
  });

  it('tells whoever is listening when the device is unlocked and when it is locked, once each', () => {
    const { license } = holding(null);
    const heard = vi.fn();
    const stop = license.subscribe(heard);
    license.keep('not a file', 'account');
    expect(heard).not.toHaveBeenCalled();
    license.keep(FILE, 'account');
    license.keep(FILE, 'account');
    expect(heard).toHaveBeenCalledTimes(1);
    license.loggedOut();
    license.loggedOut();
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    const quiet = holding(null).license;
    const unheard = vi.fn();
    quiet.subscribe(unheard)();
    quiet.keep(FILE, 'account');
    expect(unheard).not.toHaveBeenCalled();
  });
});

describe('fetching the license file of the account that is logged in', () => {
  it('keeps the file the server gives', async () => {
    const asked = answering(200, { file: FILE });
    const { license } = holding(null);
    await fetchDeviceLicense(SITE, undefined, license);
    expect(asked).toEqual([`${SITE}api/upgrade/license`]);
    expect(license.upgraded).toBe(true);
  });

  it('asks nothing of the server when the device already holds a good one', async () => {
    const asked = answering(200, { file: FILE });
    await fetchDeviceLicense(SITE, undefined, holding(FILE).license);
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
      await fetchDeviceLicense(SITE, undefined, license);
      expect(license.upgraded, JSON.stringify(said)).toBe(false);
    }
  });

  it('leaves the device as it was when no server answers', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const { license } = holding(null);
    await expect(fetchDeviceLicense(SITE, undefined, license)).resolves.toBeUndefined();
    expect(license.upgraded).toBe(false);
  });

  it('does not keep a file that arrives after its account has logged out', async () => {
    answering(200, { file: FILE });
    const { license } = holding(null);
    await fetchDeviceLicense(SITE, () => false, license);
    expect(license.upgraded).toBe(false);
  });
});

describe('unlocking a device with a typed key and nobody logged in', () => {
  it('asks for the key\u2019s file and keeps it as a key\u2019s', async () => {
    const asked = answering(200, { file: FILE });
    const { license } = holding(null);
    expect(await unlockWithKey(SITE, 'BOOM-7K3QF-9XW2M-HT4RD-6VNPA', license)).toBeNull();
    expect(asked).toEqual([`POST ${SITE}api/upgrade/license {"key":"BOOM-7K3QF-9XW2M-HT4RD-6VNPA"}`]);
    expect(license.source).toBe('key');
  });

  it('says why not, in the server\u2019s words, and unlocks nothing', async () => {
    for (const [status, code] of [
      [404, 'unknown_key'],
      [403, 'withdrawn'],
      [429, 'too_many'],
    ] as const) {
      answering(status, { code, message: 'No.' });
      const { license } = holding(null);
      expect(await unlockWithKey(SITE, 'BOOM-00000-00000-00000-00000', license)).toEqual({ status, code, message: 'No.' });
      expect(license.upgraded).toBe(false);
    }
  });

  it('says so when the server\u2019s file is not one this program accepts', async () => {
    answering(200, { file: signLicenseFile(PAYLOAD, throwawayPair().signingKey) });
    const { license } = holding(null);
    expect((await unlockWithKey(SITE, 'BOOM-7K3QF-9XW2M-HT4RD-6VNPA', license))?.message).toMatch(/does not accept/);
    expect(license.upgraded).toBe(false);
  });
});

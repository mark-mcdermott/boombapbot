import { generateKeyPairSync } from 'node:crypto';
import { signLicenseFile, type LicenseFilePayload } from '@boombapbot/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KeyValueStorage } from '../src/state/draft-storage';
import { DeviceLicense, LICENSE_SOURCE_KEY } from '../src/upgrade/device-license';
import { syncWithStore, unlockWithPurchase, type StoreBridge, type StorePurchase } from '../src/upgrade/store';

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => void this.items.set(key, value);
  removeItem = (key: string) => void this.items.delete(key);
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
  issuedAt: '2026-11-26T12:00:00.000Z',
  unlocks: ['upgrade'],
};
const FILE = signLicenseFile(PAYLOAD, pair.signingKey);
const SITE = 'https://site.example/';
const PURCHASE: StorePurchase = { store: 'apple', transaction: 'signed-by-the-store' };

const device = () => {
  const storage = new MemoryStorage();
  return { storage, license: new DeviceLicense(storage, pair.publicKey) };
};

/** A server that answers every request the same way, and remembers what it was asked. */
function answering(status: number, said: unknown) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    asked.push(`${init.method} ${url} ${String(init.body)}`);
    return new Response(JSON.stringify(said), { status });
  });
  return asked;
}

/** A store that holds what it is given, and remembers whether it was asked afresh. */
function holding(purchases: StorePurchase[]) {
  const refreshed: boolean[] = [];
  const store: StoreBridge = {
    product: async () => ({ price: '$4.99' }),
    buy: async () => ({ stopped: 'cancelled' }),
    owned: async (refresh = false) => {
      refreshed.push(refresh);
      return purchases;
    },
  };
  return { store, refreshed };
}

afterEach(() => vi.unstubAllGlobals());

describe('a purchase made in a store app', () => {
  it('is shown to the server as the store signed it, and its file unlocks the device for good', async () => {
    const asked = answering(200, { file: FILE });
    const { storage, license } = device();
    expect(await unlockWithPurchase(SITE, PURCHASE, license)).toBeNull();
    expect(asked).toEqual([`POST ${SITE}api/upgrade/store ${JSON.stringify(PURCHASE)}`]);
    expect(license.source).toBe('store');

    license.loggedOut();
    license.removeKey();
    expect(license.upgraded).toBe(true);
    expect(new DeviceLicense(storage, pair.publicKey).source).toBe('store');
  });

  it('unlocks nothing the server refuses, or answers with a file this program does not accept', async () => {
    answering(400, { code: 'not_a_purchase', message: 'no' });
    const { license } = device();
    expect(await unlockWithPurchase(SITE, PURCHASE, license)).toMatchObject({ code: 'not_a_purchase' });
    expect(license.upgraded).toBe(false);

    answering(200, { file: signLicenseFile(PAYLOAD, throwawayPair().signingKey) });
    expect((await unlockWithPurchase(SITE, PURCHASE, license))?.message).toMatch(/does not accept/);
    expect(license.upgraded).toBe(false);
  });

  it('keeps a device an account unlocked unlocked after the account logs out', async () => {
    answering(200, { file: FILE });
    const { license } = device();
    license.keep(FILE, 'account');
    await unlockWithPurchase(SITE, PURCHASE, license);
    license.loggedOut();
    expect(license.source).toBe('store');
  });

  it('does not take a typed key’s place', async () => {
    answering(200, { file: FILE });
    const { storage, license } = device();
    license.keep(FILE, 'key');
    await unlockWithPurchase(SITE, PURCHASE, license);
    expect(storage.items.get(LICENSE_SOURCE_KEY)).toBe('key');
    license.purchaseGone();
    expect(license.upgraded).toBe(true);
  });
});

describe('keeping a device in step with the store', () => {
  it('unlocks a device whose buyer holds the upgrade, as after the app is installed again', async () => {
    const asked = answering(200, { file: FILE });
    const { license } = device();
    const { store, refreshed } = holding([PURCHASE]);
    expect(await syncWithStore(SITE, store, false, license)).toEqual({ held: true, failure: null });
    expect(license.source).toBe('store');
    expect(asked).toHaveLength(1);
    expect(refreshed).toEqual([false]);
  });

  it('asks the store afresh only when told to, which is what restoring is', async () => {
    answering(200, { file: FILE });
    const { store, refreshed } = holding([PURCHASE]);
    await syncWithStore(SITE, store, true, device().license);
    expect(refreshed).toEqual([true]);
  });

  it('locks a device a purchase unlocked once the store holds none, and asks no server', async () => {
    const asked = answering(200, { file: FILE });
    const { license } = device();
    license.keep(FILE, 'store');
    expect(await syncWithStore(SITE, holding([]).store, false, license)).toEqual({ held: false, failure: null });
    expect(license.upgraded).toBe(false);
    expect(asked).toEqual([]);
  });

  it('leaves a device an account or a key unlocked alone when the store holds nothing', async () => {
    for (const source of ['account', 'key'] as const) {
      const { license } = device();
      license.keep(FILE, source);
      await syncWithStore(SITE, holding([]).store, false, license);
      expect(license.source).toBe(source);
    }
  });

  it('locks a device whose purchase the server says was refunded, though the store still lists it', async () => {
    answering(403, { code: 'withdrawn', message: 'refunded' });
    const { license } = device();
    license.keep(FILE, 'store');
    const { failure } = await syncWithStore(SITE, holding([PURCHASE]).store, false, license);
    expect(failure).toMatchObject({ code: 'withdrawn' });
    expect(license.upgraded).toBe(false);
  });

  it('leaves the device as it was when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    const { license } = device();
    license.keep(FILE, 'store');
    const { held, failure } = await syncWithStore(SITE, holding([PURCHASE]).store, false, license);
    expect(held).toBe(true);
    expect(failure).not.toBeNull();
    expect(license.upgraded).toBe(true);
  });
});

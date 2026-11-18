import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LICENSE_KEY_ALPHABET,
  LICENSE_KEY_LENGTH,
  LICENSE_KEY_PATTERN,
  LicenseSchema,
  UPGRADE_CURRENCY,
  UPGRADE_PRICE_CENTS,
  licenseKeyFromBytes,
  normalizeLicenseKey,
} from '../src/upgrade';

const KEY = 'BOOM-7K3QF-9XW2M-HT4RD-6VNPA';

describe('the upgrade', () => {
  it('costs five dollars, once', () => {
    expect(UPGRADE_PRICE_CENTS).toBe(500);
    expect(UPGRADE_CURRENCY).toBe('usd');
  });
});

describe('a license key', () => {
  it('is BOOM and four groups of five, from an alphabet with no I, L, O or U', () => {
    expect(LICENSE_KEY_ALPHABET).toHaveLength(32);
    expect(LICENSE_KEY_ALPHABET).not.toMatch(/[ILOU]/);
    expect(LICENSE_KEY_LENGTH).toBe(20);
    expect(KEY).toMatch(LICENSE_KEY_PATTERN);
    for (const wrong of ['BOOM-7K3QF-9XW2M-HT4RD', 'BOOM-7K3QF-9XW2M-HT4RD-6VNPU', 'boom-7k3qf-9xw2m-ht4rd-6vnpa', `${KEY}-AAAAA`]) {
      expect(wrong).not.toMatch(LICENSE_KEY_PATTERN);
    }
  });

  it('spells its bytes one character each, every character as likely as another', () => {
    expect(licenseKeyFromBytes(new Uint8Array(20))).toBe('BOOM-00000-00000-00000-00000');
    expect(licenseKeyFromBytes(Uint8Array.from({ length: 20 }, (_, index) => index))).toBe('BOOM-01234-56789-ABCDE-FGHJK');
    expect(licenseKeyFromBytes(new Uint8Array(20).fill(255))).toBe('BOOM-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ');
    // 256 values over 32 letters: each letter is spelled by exactly eight of them.
    const spelled = Array.from({ length: 256 }, (_, byte) => licenseKeyFromBytes(new Uint8Array(20).fill(byte))[5]);
    for (const letter of LICENSE_KEY_ALPHABET) expect(spelled.filter((one) => one === letter)).toHaveLength(8);
  });

  it('is never made from too few bytes or too many', () => {
    expect(() => licenseKeyFromBytes(new Uint8Array(19))).toThrow(/20 random bytes/);
    expect(() => licenseKeyFromBytes(new Uint8Array(21))).toThrow(/20 random bytes/);
  });

  it('does not repeat, and always fits its own pattern and schema', () => {
    const keys = Array.from({ length: 2000 }, () => licenseKeyFromBytes(randomBytes(LICENSE_KEY_LENGTH)));
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(LICENSE_KEY_PATTERN);
      expect(normalizeLicenseKey(key)).toBe(key);
    }
    const license = { id: crypto.randomUUID(), key: keys[0], issuedAt: new Date().toISOString() };
    expect(LicenseSchema.parse(license)).toEqual(license);
    expect(LicenseSchema.safeParse({ ...license, key: 'BOOM' }).success).toBe(false);
  });

  it('is read back however it was typed', () => {
    for (const typed of [
      KEY,
      KEY.toLowerCase(),
      `  ${KEY}\n`,
      'BOOM7K3QF9XW2MHT4RD6VNPA',
      'boom 7k3qf 9xw2m ht4rd 6vnpa',
      '7K3QF-9XW2M-HT4RD-6VNPA',
      '7k3qf9xw2mht4rd6vnpa',
      'B00M-7K3QF-9XW2M-HT4RD-6VNPA',
    ]) {
      expect(normalizeLicenseKey(typed), typed).toBe(KEY);
    }
  });

  it('takes a letter O, I or L for the digit it looks like', () => {
    expect(normalizeLicenseKey('BOOM-O0o0O-IiLl1-00000-00000')).toBe('BOOM-00000-11111-00000-00000');
    // A key whose own first characters look like the prefix keeps them.
    expect(normalizeLicenseKey('BOOMA-AAAAA-AAAAA-AAAAA')).toBe('BOOM-B00MA-AAAAA-AAAAA-AAAAA');
    expect(normalizeLicenseKey('BOOM-BOOMA-AAAAA-AAAAA-AAAAA')).toBe('BOOM-B00MA-AAAAA-AAAAA-AAAAA');
  });

  it('is refused when it cannot be a key', () => {
    for (const typed of [
      '',
      'BOOM',
      'BOOM-7K3QF-9XW2M-HT4RD',
      `${KEY}A`,
      'BOOM-7K3QF-9XW2M-HT4RD-6VNPU',
      'BOOM-7K3QF-9XW2M-HT4RD-6VN_A',
      'ROOM-7K3QF-9XW2M-HT4RD-6VNPA',
      '3f2b8c1e-9a47-4d0b-b6e2-5c81f0a7d394',
    ]) {
      expect(normalizeLicenseKey(typed), typed).toBeNull();
    }
  });
});

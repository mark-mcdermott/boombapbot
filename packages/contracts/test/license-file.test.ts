import { createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LICENSE_FILE_MAX_LENGTH,
  LICENSE_FILE_PREFIX,
  LICENSE_PUBLIC_KEY,
  LicenseFileAnswerSchema,
  UPGRADE_UNLOCK,
  fromBase64Url,
  licensePublicKey,
  signLicenseFile,
  toBase64Url,
  unlocksUpgrade,
  verifyLicenseFile,
  type LicenseFilePayload,
} from '../src/license-file';

/** A pair made for this run and thrown away with it, by Node's own Ed25519 and not the library the code uses. */
function throwawayPair(): { signingKey: Uint8Array; publicKey: string; nodeKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'jwk' }).d;
  const x = publicKey.export({ format: 'jwk' }).x;
  if (!seed || !x) throw new Error('Node made an Ed25519 pair without its key material.');
  return { signingKey: new Uint8Array(Buffer.from(seed, 'base64url')), publicKey: x, nodeKey: privateKey };
}

const PAYLOAD: LicenseFilePayload = {
  version: 1,
  licenseId: '3f2b8c1e-9a47-4d0b-b6e2-5c81f0a7d394',
  issuedAt: '2026-11-22T12:00:00.000Z',
  unlocks: [UPGRADE_UNLOCK],
};

const pair = throwawayPair();
const file = signLicenseFile(PAYLOAD, pair.signingKey);
const [, payloadPart = '', signaturePart = ''] = file.split('.');

const encoded = (value: unknown) => toBase64Url(new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)));

/** A file whose signature is good, by Node's signer, over whatever payload and prefix it is given. */
function signedByNode(payload: unknown, prefix = LICENSE_FILE_PREFIX, key = pair.nodeKey): string {
  const signed = `${prefix}.${encoded(payload)}`;
  return `${signed}.${sign(null, Buffer.from(signed), key).toString('base64url')}`;
}

describe('a license file', () => {
  it('is three parts, and says what it unlocks once its signature holds', () => {
    expect(file).toMatch(/^boombapbot-license\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/);
    const check = verifyLicenseFile(file, pair.publicKey);
    expect(check).toEqual({
      valid: true,
      licenseId: PAYLOAD.licenseId,
      issuedAt: PAYLOAD.issuedAt,
      unlocks: ['upgrade'],
    });
    expect(unlocksUpgrade(check)).toBe(true);
    expect(LicenseFileAnswerSchema.safeParse({ file }).success).toBe(true);
  });

  it('is read with space or a line ending around it', () => {
    for (const text of [`${file}\n`, `${file}\r\n`, `  ${file}\t`]) {
      expect(verifyLicenseFile(text, pair.publicKey).valid, JSON.stringify(text)).toBe(true);
    }
  });

  it('is the same check another Ed25519 makes', () => {
    const signed = file.slice(0, file.lastIndexOf('.'));
    const nodePublicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pair.publicKey }, format: 'jwk' });
    expect(verify(null, Buffer.from(signed), nodePublicKey, Buffer.from(signaturePart, 'base64url'))).toBe(true);
    expect(verifyLicenseFile(signedByNode(PAYLOAD), pair.publicKey).valid).toBe(true);
    expect(signedByNode(PAYLOAD)).toBe(file);
    expect(licensePublicKey(pair.signingKey)).toBe(pair.publicKey);
  });

  it('matches the worked example in docs/license-file.md', () => {
    // RFC 8032, section 7.1, test 1: a key pair anybody can read, so it signs nothing real.
    const seed = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
    const publicKey = toBase64Url(new Uint8Array(Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex')));
    const example =
      'boombapbot-license.eyJ2ZXJzaW9uIjoxLCJsaWNlbnNlSWQiOiIzZjJiOGMxZS05YTQ3LTRkMGItYjZlMi01YzgxZjBhN2QzOTQiLCJpc3N1ZWRBdCI6IjIwMjYtMTEtMjJUMTI6MDA6MDAuMDAwWiIsInVubG9ja3MiOlsidXBncmFkZSJdfQ.mPyrMgMf4Pcw9sm3Z8j3mWZtAuOSYKulYqsstJpknUvhr3QoNhOBvTvJWIr8hvssyw8eai5d2uwo4qdSCk3-BA';
    expect(signLicenseFile(PAYLOAD, new Uint8Array(Buffer.from(seed, 'hex')))).toBe(example);
    expect(verifyLicenseFile(example, publicKey).valid).toBe(true);
  });

  it('is refused when one character of it is changed', () => {
    for (let at = 0; at < file.length; at += 1) {
      const swapped = file[at] === 'A' ? 'B' : 'A';
      const changed = `${file.slice(0, at)}${swapped}${file.slice(at + 1)}`;
      expect(verifyLicenseFile(changed, pair.publicKey).valid, `character ${at}`).toBe(false);
    }
  });

  it('is refused when its payload is swapped for another under the same signature', () => {
    const forged = `${LICENSE_FILE_PREFIX}.${encoded({ ...PAYLOAD, licenseId: '11111111-1111-4111-8111-111111111111' })}.${signaturePart}`;
    expect(verifyLicenseFile(forged, pair.publicKey)).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('is refused when it is cut short anywhere', () => {
    for (let length = 0; length < file.length; length += 1) {
      const check = verifyLicenseFile(file.slice(0, length), pair.publicKey);
      expect(check.valid, `${length} characters`).toBe(false);
    }
    expect(verifyLicenseFile(file.slice(0, -1), pair.publicKey)).toEqual({ valid: false, reason: 'malformed' });
    expect(verifyLicenseFile(`${LICENSE_FILE_PREFIX}.${payloadPart}`, pair.publicKey)).toEqual({ valid: false, reason: 'malformed' });
  });

  it('is refused against any key but the one it was signed with', () => {
    const wrong = { valid: false, reason: 'bad_signature' };
    expect(verifyLicenseFile(file, throwawayPair().publicKey)).toEqual(wrong);
    expect(verifyLicenseFile(file, '')).toEqual(wrong);
    expect(verifyLicenseFile(file, pair.publicKey.slice(0, -2))).toEqual(wrong);
    expect(verifyLicenseFile(file, 'not a key')).toEqual(wrong);
    // An identity point as the key would let a forged signature through a careless check.
    expect(verifyLicenseFile(file, toBase64Url(Uint8Array.from({ length: 32 }, (_, at) => (at === 0 ? 1 : 0))))).toEqual(wrong);
  });

  it('is refused in a version this code does not read, however well it is signed', () => {
    for (const version of [0, 2, 1.5]) {
      expect(verifyLicenseFile(signedByNode({ ...PAYLOAD, version }), pair.publicKey), String(version)).toEqual({
        valid: false,
        reason: 'unsupported_version',
      });
    }
    // An unsigned claim to be another version is told nothing about versions.
    const unsigned = `${LICENSE_FILE_PREFIX}.${encoded({ ...PAYLOAD, version: 2 })}.${signaturePart}`;
    expect(verifyLicenseFile(unsigned, pair.publicKey)).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('is refused when it is well signed and says too little', () => {
    const { unlocks: _unlocks, ...withoutUnlocks } = PAYLOAD;
    for (const payload of [
      withoutUnlocks,
      { ...PAYLOAD, unlocks: [] },
      { ...PAYLOAD, unlocks: 'upgrade' },
      { ...PAYLOAD, licenseId: 'BOOM-7K3QF-9XW2M-HT4RD-6VNPA' },
      { ...PAYLOAD, issuedAt: 'yesterday' },
      { ...PAYLOAD, version: '1' },
      [PAYLOAD],
      'not json {',
      null,
    ]) {
      expect(verifyLicenseFile(signedByNode(payload), pair.publicKey), JSON.stringify(payload)).toEqual({
        valid: false,
        reason: 'malformed',
      });
    }
  });

  it('is refused when it is some other signed thing, or not a license file at all', () => {
    const malformed = { valid: false, reason: 'malformed' };
    for (const text of [
      '',
      'BOOM-7K3QF-9XW2M-HT4RD-6VNPA',
      signedByNode(PAYLOAD, 'boombapbot-receipt'),
      `${file}.${signaturePart}`,
      `${LICENSE_FILE_PREFIX}.${payloadPart}=.${signaturePart}`,
      `${LICENSE_FILE_PREFIX}.${payloadPart}.${signaturePart}==`,
      `${LICENSE_FILE_PREFIX}.${payloadPart} .${signaturePart}`,
      `${LICENSE_FILE_PREFIX}..${signaturePart}`,
      `${file}${' '.repeat(LICENSE_FILE_MAX_LENGTH)}`,
    ]) {
      expect(verifyLicenseFile(text, pair.publicKey), JSON.stringify(text.slice(0, 60))).toEqual(malformed);
    }
  });

  it('keeps names it does not know, and unlocks the upgrade only when it names it', () => {
    const later = verifyLicenseFile(signedByNode({ ...PAYLOAD, unlocks: ['upgrade', 'something-later'], note: 'ignored' }), pair.publicKey);
    expect(later).toMatchObject({ valid: true, unlocks: ['upgrade', 'something-later'] });
    expect(unlocksUpgrade(later)).toBe(true);
    expect(unlocksUpgrade(verifyLicenseFile(signedByNode({ ...PAYLOAD, unlocks: ['something-later'] }), pair.publicKey))).toBe(false);
    expect(unlocksUpgrade(verifyLicenseFile(file, throwawayPair().publicKey))).toBe(false);
  });

  it('is checked against the built-in key unless another is given', () => {
    expect(LICENSE_PUBLIC_KEY === '' || fromBase64Url(LICENSE_PUBLIC_KEY)?.length === 32).toBe(true);
    expect(verifyLicenseFile(file)).toEqual({ valid: false, reason: 'bad_signature' });
  });
});

describe('base64url', () => {
  it('goes there and back, and reads only what it would have written', () => {
    for (const length of [0, 1, 2, 3, 32, 64]) {
      const bytes = Uint8Array.from({ length }, (_, at) => (at * 37 + 251) % 256);
      expect(fromBase64Url(toBase64Url(bytes)) ?? new Uint8Array(), String(length)).toEqual(bytes);
    }
    for (const text of ['', 'a', 'ab=', 'a+b/', 'ab cd', 'ab\n', 'AB', 'AAB']) {
      expect(fromBase64Url(text), JSON.stringify(text)).toBeNull();
    }
  });
});

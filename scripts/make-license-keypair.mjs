#!/usr/bin/env node
// Makes the Ed25519 pair that license files are signed and checked with, and
// prints both halves. Nothing is written anywhere: the signing key goes into
// Vercel as LICENSE_SIGNING_KEY and nowhere else, and the public key goes into
// LICENSE_PUBLIC_KEY in packages/contracts/src/license-file.ts and into the
// plugin. See docs/license-file.md.
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const { d: signingKey } = privateKey.export({ format: 'jwk' });
const { x: verifyingKey } = publicKey.export({ format: 'jwk' });
const bytes = [...Buffer.from(verifyingKey, 'base64url')].map((byte) => `0x${byte.toString(16).padStart(2, '0')}`);

console.log(`LICENSE_SIGNING_KEY (secret: Vercel only, never in a file that is committed)
  ${signingKey}

LICENSE_PUBLIC_KEY (public: built into every program)
  ${verifyingKey}

The same public key as bytes, for C++
  ${bytes.join(', ')}`);

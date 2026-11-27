import { createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { expect, type APIResponse } from '@playwright/test';
import { ROW_ID } from './account';
import { LICENSE_SIGNING_KEY } from './accounts-server';

// What the tests of the upgrade share: reading a license file the server
// signed, and a refusal.

/** The public half of the test server's signing key, worked out by Node from the 32 bytes the server was given. */
const LICENSE_VERIFYING_KEY = createPublicKey(
  createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(LICENSE_SIGNING_KEY, 'base64url')]),
    format: 'der',
    type: 'pkcs8',
  }),
);

/**
 * What a license file says, once Node's own Ed25519 has checked it the way
 * docs/license-file.md describes: the signature is over everything before
 * the last dot.
 */
export async function licenseFileIn(answer: APIResponse): Promise<{ version: number; licenseId: string; issuedAt: string; unlocks: string[] }> {
  expect(answer.status(), await answer.text()).toBe(200);
  const text = await answer.text();
  expect(text).not.toMatch(ROW_ID);
  const body = JSON.parse(text);
  expect(Object.keys(body)).toEqual(['file']);
  const [prefix, payload, signature, ...more] = (body.file as string).split('.');
  expect(more).toEqual([]);
  expect(prefix).toBe('boombapbot-license');
  const signed = Buffer.from(`${prefix}.${payload}`);
  expect(verify(null, signed, LICENSE_VERIFYING_KEY, Buffer.from(signature!, 'base64url'))).toBe(true);
  return JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
}

/** Checks an answer is the refusal it should be: its status, its code and a sentence for the person. */
export async function refused(answer: APIResponse, status: number, code: string): Promise<void> {
  expect(answer.status(), await answer.text()).toBe(status);
  expect(await answer.json()).toMatchObject({ code, message: expect.stringMatching(/\S/) });
}

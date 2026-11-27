import { execFileSync } from 'node:child_process';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// A stand-in for the App Store's signature. Apple signs a purchase with a
// certificate that leads back to its root; the tests make a root of their
// own, hand it to the test server in place of Apple's, and sign with what
// hangs off it. The chain carries the two markers Apple's carries, so the
// server checks it exactly as it checks a real one.

export const APPLE_APP_ID = '6700000001';
const BUNDLE_ID = 'com.boombapbot.app';
export const UPGRADE_PRODUCT = 'com.boombapbot.app.upgrade';

const WWDR_MARKER = '1.2.840.113635.100.6.2.1';
const RECEIPT_SIGNING_MARKER = '1.2.840.113635.100.6.11.1';

const openssl = (...args: string[]) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

/** Makes a root, an intermediate and a leaf in `folder`, each with a key of its own. */
function makeChain(folder: string): void {
  mkdirSync(folder, { recursive: true });
  const at = (name: string) => join(folder, name);
  for (const name of ['root', 'intermediate', 'leaf']) {
    openssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', at(`${name}.sec1`));
    openssl('pkcs8', '-topk8', '-nocrypt', '-in', at(`${name}.sec1`), '-out', at(`${name}.key`));
  }
  writeFileSync(
    at('extensions.cnf'),
    [
      '[req]',
      'distinguished_name = name',
      '[name]',
      '[root]',
      'basicConstraints = critical, CA:TRUE',
      '[intermediate]',
      'basicConstraints = critical, CA:TRUE',
      `${WWDR_MARKER} = DER:0500`,
      '[leaf]',
      `${RECEIPT_SIGNING_MARKER} = DER:0500`,
      '',
    ].join('\n'),
  );
  const config = at('extensions.cnf');
  openssl('req', '-x509', '-new', '-key', at('root.key'), '-subj', '/CN=Browser Tests Root', '-days', '2', '-config', config, '-extensions', 'root', '-out', at('root.pem'));
  const issue = (name: string, issuer: string) => {
    openssl('req', '-new', '-key', at(`${name}.key`), '-subj', `/CN=Browser Tests ${name}`, '-config', config, '-out', at(`${name}.csr`));
    openssl('x509', '-req', '-in', at(`${name}.csr`), '-CA', at(`${issuer}.pem`), '-CAkey', at(`${issuer}.key`), '-CAcreateserial', '-days', '2', '-extfile', config, '-extensions', name, '-out', at(`${name}.pem`));
  };
  issue('intermediate', 'root');
  issue('leaf', 'intermediate');
}

/**
 * Where the chain is: made by whichever process starts the run and named to
 * its workers through the environment, as the license signing key is.
 */
const CHAIN = (process.env.BOOMBAPBOT_E2E_APPLE_CHAIN ??= (() => {
  const folder = resolve('build/e2e-app-store', randomUUID());
  makeChain(folder);
  return folder;
})());

/** A certificate of the chain, in DER as base64: what a signature's header carries and what the server is given as its root. */
const certificate = (name: string, folder = CHAIN) =>
  readFileSync(join(folder, `${name}.pem`), 'utf8').replace(/-----[A-Z ]+-----|\s/g, '');

/** The root the test server trusts in place of Apple's. */
export const APPLE_ROOT_CA = certificate('root');

const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** `payload` signed the way the App Store signs: ES256, with the chain in the header. */
function signed(payload: Record<string, unknown>, folder = CHAIN): string {
  const header = { alg: 'ES256', x5c: ['leaf', 'intermediate', 'root'].map((name) => certificate(name, folder)) };
  const body = `${encoded(header)}.${encoded(payload)}`;
  const key = createPrivateKey(readFileSync(join(folder, 'leaf.key'), 'utf8'));
  return `${body}.${sign('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

export interface Purchase {
  originalTransactionId: string;
  productId?: string;
  bundleId?: string;
  environment?: 'Production' | 'Sandbox' | 'Xcode';
  revocationDate?: number;
}

const transactionOf = ({ originalTransactionId, ...rest }: Purchase) => ({
  originalTransactionId,
  transactionId: originalTransactionId,
  productId: UPGRADE_PRODUCT,
  bundleId: BUNDLE_ID,
  environment: 'Production',
  type: 'Non-Consumable',
  signedDate: Date.now(),
  ...rest,
});

/** A new purchase id, as the App Store numbers them. */
export const newPurchaseId = () => String(2_000_000_000_000_000 + Math.floor(Math.random() * 1e15));

/** What the app is handed by the App Store for a purchase, and hands on to the server. */
export const signedTransaction = (purchase: Purchase) => signed(transactionOf(purchase));

/** The same, signed under a root the server was never told of. */
export function forgedTransaction(purchase: Purchase): string {
  const folder = resolve('build/e2e-app-store', randomUUID());
  makeChain(folder);
  return signed(transactionOf(purchase), folder);
}

/** What the App Store sends the server when something happens to a purchase. */
export function signedNotice(notificationType: string, purchase: Purchase, forged = false): { signedPayload: string } {
  const environment = purchase.environment ?? 'Production';
  const notice = {
    notificationType,
    notificationUUID: randomUUID(),
    version: '2.0',
    signedDate: Date.now(),
    data: {
      appAppleId: Number(APPLE_APP_ID),
      bundleId: BUNDLE_ID,
      environment,
      signedTransactionInfo: signedTransaction(purchase),
    },
  };
  if (!forged) return { signedPayload: signed(notice) };
  const folder = resolve('build/e2e-app-store', randomUUID());
  makeChain(folder);
  return { signedPayload: signed(notice, folder) };
}

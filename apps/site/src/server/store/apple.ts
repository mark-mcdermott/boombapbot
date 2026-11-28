import { APPLE_APP_ID, APPLE_ROOT_CA } from 'astro:env/server';
import {
  Environment,
  NotificationTypeV2,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
  type JWSTransactionDecodedPayload,
} from '@apple/app-store-server-library';
import { APP_BUNDLE_ID, STORE_UPGRADE_PRODUCT } from '@boombapbot/contracts';
import { APPLE_ROOT_CA_G3 } from './apple-root';
import type { StorePurchase } from './purchase';

/** What Apple's notice asks of a license: nothing, to withdraw it, or to give it back. */
export type AppleNotice = { purchase: StorePurchase; effect: 'withdraw' | 'reinstate' } | null;

/**
 * One verifier for each of the App Store's two worlds, the real one first.
 * Null until APPLE_APP_ID is set, which is the app's number in App Store
 * Connect: without an app there is nothing to sell. The browser tests name
 * a root of their own in APPLE_ROOT_CA; with Apple's, each certificate is
 * also asked after at Apple, in case it was revoked.
 */
function verifiers(): SignedDataVerifier[] | null {
  const appId = Number(APPLE_APP_ID);
  if (!APPLE_APP_ID || !Number.isSafeInteger(appId)) return null;
  const roots = [Buffer.from(APPLE_ROOT_CA ?? APPLE_ROOT_CA_G3, 'base64')];
  const online = !APPLE_ROOT_CA;
  return [Environment.PRODUCTION, Environment.SANDBOX].map(
    (environment) => new SignedDataVerifier(roots, online, environment, APP_BUNDLE_ID, appId),
  );
}

/** Whether the server can check an App Store purchase at all. */
export function appleStoreOpen(): boolean {
  return verifiers() !== null;
}

/**
 * What the first verifier to accept `signed` makes of it. A signature from
 * the other world is the next verifier's to read; one that could not be
 * checked just now is an error, so that whoever sent it tries again; any
 * other failure is null, since nothing Apple did not sign is believed.
 */
async function verified<T>(read: (verifier: SignedDataVerifier) => Promise<T>): Promise<T | null> {
  for (const verifier of verifiers() ?? []) {
    try {
      return await read(verifier);
    } catch (error) {
      if (!(error instanceof VerificationException)) throw error;
      if (error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE) throw error;
    }
  }
  return null;
}

function purchaseIn(transaction: JWSTransactionDecodedPayload): StorePurchase | null {
  if (transaction.productId !== STORE_UPGRADE_PRODUCT || !transaction.originalTransactionId) return null;
  return {
    store: 'apple',
    id: transaction.originalTransactionId,
    sandbox: transaction.environment === Environment.SANDBOX,
    revoked: transaction.revocationDate !== undefined,
  };
}

/** The purchase a signed transaction from the app is, or null when Apple did not sign it for the upgrade in this app. */
export async function readAppleTransaction(signed: string): Promise<StorePurchase | null> {
  const transaction = await verified((verifier) => verifier.verifyAndDecodeTransaction(signed));
  return transaction && purchaseIn(transaction);
}

const EFFECTS: Partial<Record<string, 'withdraw' | 'reinstate'>> = {
  [NotificationTypeV2.REFUND]: 'withdraw',
  [NotificationTypeV2.REVOKE]: 'withdraw',
  [NotificationTypeV2.REFUND_REVERSED]: 'reinstate',
};

/**
 * What a notice from the App Store asks for. `undefined` when Apple did not
 * sign it; null when it did and it is about something else.
 */
export async function readAppleNotice(signedPayload: string): Promise<AppleNotice | undefined> {
  const read = await verified(async (verifier) => {
    const notice = await verifier.verifyAndDecodeNotification(signedPayload);
    const effect = EFFECTS[notice.notificationType ?? ''];
    const signed = notice.data?.signedTransactionInfo;
    if (!effect || !signed) return { notice: null };
    const purchase = purchaseIn(await verifier.verifyAndDecodeTransaction(signed));
    return { notice: purchase && { purchase, effect } };
  });
  return read ? read.notice : undefined;
}

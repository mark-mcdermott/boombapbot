import { createSign } from 'node:crypto';
import { GOOGLE_PLAY_API_URL, GOOGLE_PLAY_SERVICE_ACCOUNT } from 'astro:env/server';
import { APP_BUNDLE_ID, STORE_UPGRADE_PRODUCT } from '@boombapbot/contracts';
import { z } from 'zod';
import type { StorePurchase } from './purchase';

// Google Play signs nothing an app can hand on. The app sends the token
// Play gave it for a purchase, and the server asks Google, as a service
// account the owner made, what that token bought.

const ServiceAccountSchema = z.object({
  client_email: z.string().min(1),
  private_key: z.string().min(1),
  token_uri: z.url(),
});
type ServiceAccount = z.infer<typeof ServiceAccountSchema>;

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const ASSERTION_SECONDS = 600;
const EARLY_MS = 60_000;

/** The service account's key file, as Google hands it out, or null when none is set. One that is set and cannot be read is an error, not a closed door. */
function serviceAccount(): ServiceAccount | null {
  if (!GOOGLE_PLAY_SERVICE_ACCOUNT) return null;
  const read = ServiceAccountSchema.safeParse(JSON.parse(GOOGLE_PLAY_SERVICE_ACCOUNT));
  if (!read.success) throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT is not a service account key file from Google.');
  return read.data;
}

/** Whether the server can ask Google about a purchase at all. */
export function googleStoreOpen(): boolean {
  return serviceAccount() !== null;
}

const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** What the service account signs to be given a token: who it is and what it wants to do, good for ten minutes. */
function assertion(account: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: account.client_email, scope: SCOPE, aud: account.token_uri, iat: now, exp: now + ASSERTION_SECONDS };
  const body = `${encoded({ alg: 'RS256', typ: 'JWT' })}.${encoded(claims)}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(account.private_key, 'base64url')}`;
}

const AccessTokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });

let held: { token: string; until: number } | null = null;

/** A token Google takes calls with, asked for again a minute before it runs out. */
async function accessToken(account: ServiceAccount): Promise<string> {
  if (held && held.until > Date.now()) return held.token;
  const answer = await fetch(account.token_uri, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion(account) }),
  });
  if (!answer.ok) throw new Error(`Google gave the service account no token: ${answer.status} ${await answer.text()}`);
  const { access_token, expires_in } = AccessTokenSchema.parse(await answer.json());
  held = { token: access_token, until: Date.now() + expires_in * 1000 - EARLY_MS };
  return access_token;
}

/** One call about a purchase of the upgrade, by its token. */
async function ask(purchaseToken: string, action: '' | ':acknowledge'): Promise<Response> {
  const account = serviceAccount();
  if (!account) throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT is not set.');
  const base = GOOGLE_PLAY_API_URL ?? 'https://androidpublisher.googleapis.com';
  const path = [
    'androidpublisher/v3/applications',
    APP_BUNDLE_ID,
    'purchases/products',
    STORE_UPGRADE_PRODUCT,
    'tokens',
    encodeURIComponent(purchaseToken),
  ].join('/');
  return fetch(`${base}/${path}${action}`, {
    method: action ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${await accessToken(account)}`, ...(action && { 'content-type': 'application/json' }) },
    ...(action && { body: '{}' }),
  });
}

const PURCHASED = 0;
const CANCELED = 1;
const TEST_PURCHASE = 0;
const ACKNOWLEDGED = 1;

const ProductPurchaseSchema = z.object({
  purchaseState: z.number().int(),
  purchaseType: z.number().int().optional(),
  acknowledgementState: z.number().int().optional(),
});

/** Google's answers that mean it knows no such purchase of the upgrade in this app. Any other failure is its own, and an error. */
const UNKNOWN_TO_GOOGLE = [400, 404, 410];

/** A purchase Google vouched for, and whether the server has told Google the buyer was given what they paid for. */
export type GooglePurchase = StorePurchase & { acknowledged: boolean };

/**
 * What Google says a purchase token bought, or null when it is no purchase
 * of the upgrade in this app, or one not paid for yet. A purchase Google
 * calls canceled is one it refunded or took back.
 */
export async function readGooglePurchase(purchaseToken: string): Promise<GooglePurchase | null> {
  const answer = await ask(purchaseToken, '');
  if (UNKNOWN_TO_GOOGLE.includes(answer.status)) return null;
  if (!answer.ok) throw new Error(`Google could not be asked about a purchase: ${answer.status} ${await answer.text()}`);
  const bought = ProductPurchaseSchema.parse(await answer.json());
  if (bought.purchaseState !== PURCHASED && bought.purchaseState !== CANCELED) return null;
  return {
    store: 'google',
    id: purchaseToken,
    sandbox: bought.purchaseType === TEST_PURCHASE,
    revoked: bought.purchaseState === CANCELED,
    acknowledged: bought.acknowledgementState === ACKNOWLEDGED,
  };
}

/**
 * Tells Google the buyer has what they paid for. Google refunds a purchase
 * nobody acknowledges within three days, so this follows the license and an
 * error is meant to reach the app, which shows the purchase again.
 */
export async function acknowledgeGooglePurchase(purchase: GooglePurchase): Promise<void> {
  if (purchase.acknowledged) return;
  const answer = await ask(purchase.id, ':acknowledge');
  if (!answer.ok) throw new Error(`Google did not take the acknowledgement of a purchase: ${answer.status} ${await answer.text()}`);
}

const NoticeSchema = z.object({
  packageName: z.string(),
  oneTimeProductNotification: z.object({ notificationType: z.number().int(), purchaseToken: z.string().min(1), sku: z.string() }).optional(),
  voidedPurchaseNotification: z.object({ purchaseToken: z.string().min(1), productType: z.number().int(), refundType: z.number().int() }).optional(),
});

const ONE_TIME_PRODUCT_CANCELED = 2;
const PRODUCT_TYPE_ONE_TIME = 2;
const REFUND_TYPE_FULL_REFUND = 1;

/**
 * The purchase a notice from Google Play says was refunded or taken back,
 * by its token, or null when the notice is about anything else. `undefined`
 * when it is not one of Google's notices at all.
 */
export function voidedByGoogleNotice(data: string): string | null | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  } catch {
    return undefined;
  }
  const notice = NoticeSchema.safeParse(decoded);
  if (!notice.success) return undefined;
  if (notice.data.packageName !== APP_BUNDLE_ID) return null;
  const { oneTimeProductNotification: product, voidedPurchaseNotification: voided } = notice.data;
  if (voided?.productType === PRODUCT_TYPE_ONE_TIME && voided.refundType === REFUND_TYPE_FULL_REFUND) return voided.purchaseToken;
  if (product?.notificationType === ONE_TIME_PRODUCT_CANCELED && product.sku === STORE_UPGRADE_PRODUCT) return product.purchaseToken;
  return null;
}

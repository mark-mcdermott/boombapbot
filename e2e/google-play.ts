import { randomBytes } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { FAKE_SERVICES_URL } from './accounts-server';

// A stand-in for Google Play. Play signs nothing an app can hand on: the
// app sends a purchase's token and the server asks Google what it bought.
// So a test tells the fake what a token bought, and the fake answers the
// server as Google would.

const PACKAGE = 'com.boombapbot.app';
export const UPGRADE_PRODUCT = 'com.boombapbot.app.upgrade';

/** What Google says of a purchase, in its own numbers: 0 bought, 1 canceled, 2 not paid for yet. */
export interface PlayPurchase {
  purchaseState?: 0 | 1 | 2;
  /** 0 for a license tester's purchase; absent for one that was paid for. */
  purchaseType?: 0;
  acknowledgementState?: 0 | 1;
  app?: string;
  product?: string;
}

/** A new purchase token, as long and as shapeless as Play's. */
export const newPurchaseToken = () => `${randomBytes(24).toString('base64url')}.AO-J1O${randomBytes(96).toString('base64url')}`;

const at = (token: string) => `${FAKE_SERVICES_URL}/google/purchases/${encodeURIComponent(token)}`;

/** Tells the fake what `token` bought, as Play would know it after a purchase or a refund. */
export async function playKnows(request: APIRequestContext, token: string, purchase: PlayPurchase = {}): Promise<void> {
  const { app = PACKAGE, product = UPGRADE_PRODUCT, ...says } = purchase;
  const data = { app, product, says: { purchaseState: 0, acknowledgementState: 0, orderId: 'GPA.3300-0000-0000-00000', ...says } };
  expect((await request.put(at(token), { data })).status()).toBe(200);
}

/** Whether the server has told Google the buyer was given what they paid for. */
export async function acknowledged(request: APIRequestContext, token: string): Promise<boolean> {
  return (await (await request.get(at(token))).json()).says.acknowledgementState === 1;
}

/** Makes the fake refuse the next acknowledgement of `token`, as Google may. */
export async function failNextAcknowledgement(request: APIRequestContext, token: string): Promise<void> {
  expect((await request.post(`${at(token)}/fail-next-acknowledge`)).status()).toBe(200);
}

/** What Pub/Sub pushes to the server for one of Play's notices. */
export function pushed(notice: Record<string, unknown>, packageName = PACKAGE): { message: { data: string; messageId: string }; subscription: string } {
  const body = { version: '1.0', packageName, eventTimeMillis: String(Date.now()), ...notice };
  return {
    message: { data: Buffer.from(JSON.stringify(body)).toString('base64'), messageId: randomBytes(6).toString('hex') },
    subscription: 'projects/boombapbot-tests/subscriptions/play-notices',
  };
}

/** Play's notice that a one-time purchase was refunded in full. */
export const voided = (purchaseToken: string, refundType = 1, productType = 2) =>
  pushed({ voidedPurchaseNotification: { purchaseToken, orderId: 'GPA.3300-0000-0000-00000', productType, refundType } });

/** Play's notice about a one-time product: 1 bought, 2 canceled or taken back. */
export const productNotice = (purchaseToken: string, notificationType: 1 | 2, sku = UPGRADE_PRODUCT) =>
  pushed({ oneTimeProductNotification: { version: '1.0', notificationType, purchaseToken, sku } });

import { createHash, randomBytes } from 'node:crypto';
import { AUTH_RATE_LIMIT, STRIPE_WEBHOOK_SECRET, UPGRADE_OPEN } from 'astro:env/server';
import {
  LICENSE_KEY_LENGTH,
  licenseKeyFromBytes,
  normalizeLicenseKey,
  type UpgradeRefusal,
} from '@boombapbot/contracts';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import type Stripe from 'stripe';
import { requestAddress } from './auth';
import { getDb } from './db';
import { license } from './db/schema';
import { sendLicenseKeyEmail, sendLicenseKeyReminder } from './email';
import { consumeRateLimit } from './rate-limit';
import { isUpgraded, userByUuid, type SignedInUser } from './session';
import { getStripe } from './shop/stripe';
import { json } from './site';

const STATUS: Record<UpgradeRefusal, number> = {
  closed: 503,
  signed_out: 401,
  already_upgraded: 409,
  no_license: 404,
  unknown_key: 404,
  key_taken: 409,
  invalid: 400,
  too_many: 429,
  withdrawn: 403,
  no_signing_key: 503,
};

const MESSAGES: Record<UpgradeRefusal, string> = {
  closed: 'The upgrade is not open yet.',
  signed_out: 'Log in to use a license key.',
  already_upgraded: 'This account is already upgraded.',
  no_license: 'This account has no license key.',
  unknown_key: 'That is not a license key I know.',
  key_taken: 'That license key is already on another account.',
  invalid: 'That request could not be read.',
  too_many: 'I have had that request a lot just now. Try again later.',
  withdrawn: 'That license was refunded or withdrawn, so it no longer unlocks anything new.',
  no_signing_key: 'License files cannot be made just now.',
};

/** The answer when a request is turned down: why, in a word and in a sentence. */
export function refuse(code: UpgradeRefusal): Response {
  return json({ code, message: MESSAGES[code] }, STATUS[code]);
}

/**
 * Whether the upgrade can be bought right now. It is closed until
 * UPGRADE_OPEN says `on`, and stays closed without Stripe's key or the
 * webhook's secret: a payment the site never hears about would be money
 * taken and no key sent.
 */
export function upgradeOpen(): boolean {
  return UPGRADE_OPEN === 'on' && getStripe() !== null && Boolean(STRIPE_WEBHOOK_SECRET);
}

const PURPOSE = 'upgrade';

/** What a checkout carries so the webhook knows it is the upgrade, and whose. */
export function upgradeMetadata(buyer: SignedInUser | null): Record<string, string> {
  return { purpose: PURPOSE, ...(buyer && { account: buyer.uuid }) };
}

export function isUpgrade(session: Stripe.Checkout.Session): boolean {
  return session.metadata?.purpose === PURPOSE;
}

/**
 * Acts on a paid upgrade: makes its license and emails the key. Stripe
 * repeats a webhook, and can send one twice at once, so the checkout's id is
 * unique in the table: whoever writes second writes nothing and finds the
 * first one's key. The email goes out until one send has succeeded, and an
 * error here is meant to reach Stripe so that it tries again.
 *
 * A buyer who was logged in gets the license on their account. One whose
 * account already has a license, having paid twice, gets a key that is on
 * no account yet.
 */
export async function issueLicense(session: Stripe.Checkout.Session): Promise<void> {
  if (session.payment_status !== 'paid') return;
  const buyer = await userByUuid(session.metadata?.account);
  const email = (buyer?.email ?? session.customer_details?.email)?.toLowerCase();
  if (!email) throw new Error(`Stripe took payment for the upgrade in ${session.id} and gave no email for the buyer.`);

  const db = await getDb();
  const paymentIntent = session.payment_intent;
  const [issued] = await db
    .insert(license)
    .values({
      userId: buyer && !(await isUpgraded(buyer)) ? buyer.id : null,
      email,
      key: licenseKeyFromBytes(randomBytes(LICENSE_KEY_LENGTH)),
      stripeSessionId: session.id,
      stripePaymentIntentId: typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id,
    })
    .onConflictDoNothing({ target: license.stripeSessionId })
    .returning();
  const [held] = issued
    ? [issued]
    : await db.select().from(license).where(eq(license.stripeSessionId, session.id)).limit(1);
  if (!held) throw new Error(`The license for ${session.id} could not be recorded.`);
  if (held.emailedAt) return;

  await sendLicenseKeyEmail(held.email, held.key);
  const now = new Date();
  await db.update(license).set({ emailedAt: now, updatedAt: now }).where(eq(license.id, held.id));
}

/** The payment a charge was for, as Stripe names it, or undefined where it names none. */
function paymentIntentOf(charge: Stripe.Charge): string | undefined {
  const intent = charge.payment_intent;
  return typeof intent === 'string' ? intent : intent?.id;
}

/**
 * Acts on a refund: the license that payment bought is withdrawn and comes
 * off its account, which is then an account that has not upgraded. From then
 * no license file is given for it, by its key or to anybody; the files given
 * before keep working, since no program asks the server. Only a payment
 * refunded in full does it. A charge that bought no license, such as an
 * order from the shop, matches nothing here, and Stripe saying so twice
 * changes nothing the second time.
 */
export async function withdrawRefundedLicense(charge: Stripe.Charge): Promise<void> {
  const paymentIntent = paymentIntentOf(charge);
  if (!charge.refunded || !paymentIntent) return;
  const db = await getDb();
  const now = new Date();
  await db
    .update(license)
    .set({ withdrawnAt: now, userId: null, updatedAt: now })
    .where(and(eq(license.stripePaymentIntentId, paymentIntent), isNull(license.withdrawnAt)));
}

/** A license as it leaves the server: named by its uuid, without its row id. */
const licenseSummary = { id: license.uuid, key: license.key, issuedAt: license.createdAt };

/** The license on an account, or null. */
export async function licenseOf(account: SignedInUser) {
  const db = await getDb();
  const [held] = await db.select(licenseSummary).from(license).where(eq(license.userId, account.id)).limit(1);
  return held ?? null;
}

/**
 * Puts a key onto an account, and says why not when it cannot. A key goes
 * onto one account and an account takes one key; a key that is free is
 * claimed in a single statement, so two accounts asking at once cannot both
 * get it. Entering the key an account already has changes nothing.
 */
export async function redeemKey(account: SignedInUser, typed: string): Promise<UpgradeRefusal | null> {
  const key = normalizeLicenseKey(typed);
  if (!key) return 'unknown_key';
  const db = await getDb();
  const [found] = await db
    .select({ userId: license.userId, withdrawnAt: license.withdrawnAt })
    .from(license)
    .where(eq(license.key, key))
    .limit(1);
  if (!found) return 'unknown_key';
  if (found.withdrawnAt) return 'withdrawn';
  if (found.userId === account.id) return null;
  if (found.userId !== null) return 'key_taken';
  if (await isUpgraded(account)) return 'already_upgraded';

  const claimed = await db
    .update(license)
    .set({ userId: account.id, updatedAt: new Date() })
    .where(and(eq(license.key, key), isNull(license.userId), isNull(license.withdrawnAt)))
    .returning({ id: license.id });
  return claimed.length > 0 ? null : 'key_taken';
}

/**
 * How long a key that was just emailed waits before it can be asked for
 * again. The browser tests switch the site's rate limits off, this one with
 * them, to see a key sent twice without waiting.
 */
const REMINDER_GAP_MS = AUTH_RATE_LIMIT === 'off' ? 0 : 10 * 60 * 1000;

/**
 * Emails the keys bought with an address to that address again, but for
 * any that were withdrawn. A key is
 * marked as sent before it goes, in the statement that picks it, so asking
 * over and over fills nobody's inbox: each key goes out once in ten minutes
 * however many requests arrive, on however many servers.
 */
export async function remindKeys(address: string): Promise<void> {
  const email = address.toLowerCase();
  const db = await getDb();
  const now = new Date();
  const lastSentBefore = new Date(now.getTime() - REMINDER_GAP_MS);
  const due = await db
    .update(license)
    .set({ emailedAt: now, updatedAt: now })
    .where(
      and(
        eq(license.email, email),
        isNull(license.withdrawnAt),
        or(isNull(license.emailedAt), lte(license.emailedAt, lastSentBefore)),
      ),
    )
    .returning({ key: license.key });
  for (const { key } of due) await sendLicenseKeyReminder(email, key);
}

/**
 * Whether a request to email an address its keys may go ahead: three an hour
 * for one address, five in ten minutes from one place. Nothing here depends
 * on whether the address bought anything. The address is counted by its
 * hash, so the table keeps no list of who asked.
 */
export async function mayRemindKeys(request: Request, address: string): Promise<boolean> {
  if (!(await consumeRateLimit(await requestAddress(request), '/site/key-by-email/ip'))) return false;
  const hashed = createHash('sha256').update(address.toLowerCase()).digest('hex');
  return consumeRateLimit(hashed, '/site/key-by-email/address');
}

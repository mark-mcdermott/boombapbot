import { randomBytes } from 'node:crypto';
import { LICENSE_KEY_LENGTH, licenseKeyFromBytes } from '@boombapbot/contracts';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { license } from '../db/schema';
import { licenseFileForStorePurchase, type LicenseFileOutcome } from '../license-file';
import { isUpgraded, type SignedInUser } from '../session';
import type { StorePurchase } from './purchase';

type Bought = Pick<StorePurchase, 'store' | 'id'>;

/** Where each store's purchase is written on its license. */
const PAID_BY = { apple: 'appleTransactionId', google: 'googlePurchaseToken' } as const;

const boughtWith = ({ store, id }: Bought) => eq(license[PAID_BY[store]], id);

/**
 * The license a store's purchase paid for, as a signed file, made the first
 * time the purchase is shown and found again every time after: a restore on
 * another phone shows the same purchase. What the store knows it by is
 * unique in the table, so two phones showing it at once make one license.
 *
 * A store names no address, so no key is emailed. The license goes onto the
 * account that is logged in when the purchase is shown, if that account has
 * none, and that is what carries it to the site, the desktop app and the
 * plugin. Shown with nobody logged in, it unlocks the phone and waits.
 */
export async function licenseForStorePurchase(
  purchase: StorePurchase,
  account: SignedInUser | null,
): Promise<LicenseFileOutcome> {
  if (purchase.revoked) {
    await withdrawStorePurchase(purchase);
    return { refusal: 'withdrawn' };
  }
  const paidBy = PAID_BY[purchase.store];
  const holder = account && !(await isUpgraded(account)) ? account.id : null;
  const db = await getDb();
  const issued = await db
    .insert(license)
    .values({
      userId: holder,
      key: licenseKeyFromBytes(randomBytes(LICENSE_KEY_LENGTH)),
      [paidBy]: purchase.id,
      sandbox: purchase.sandbox,
    })
    .onConflictDoNothing({ target: license[paidBy] })
    .returning({ id: license.id });
  if (issued.length === 0 && holder !== null) {
    await db
      .update(license)
      .set({ userId: holder, updatedAt: new Date() })
      .where(and(boughtWith(purchase), isNull(license.userId), isNull(license.withdrawnAt)));
  }
  return licenseFileForStorePurchase(boughtWith(purchase));
}

/** The store refunded the purchase or took it back: its license is withdrawn and comes off its account, as a refund at Stripe does. */
export async function withdrawStorePurchase(purchase: Bought): Promise<void> {
  const db = await getDb();
  const now = new Date();
  await db
    .update(license)
    .set({ withdrawnAt: now, userId: null, updatedAt: now })
    .where(and(boughtWith(purchase), isNull(license.withdrawnAt)));
}

/** The store undid a refund: the license gives out files again. It is on no account until its buyer shows the purchase again. */
export async function reinstateStorePurchase(purchase: Bought): Promise<void> {
  const db = await getDb();
  await db
    .update(license)
    .set({ withdrawnAt: null, updatedAt: new Date() })
    .where(and(boughtWith(purchase), isNotNull(license.withdrawnAt)));
}

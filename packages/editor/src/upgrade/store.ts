import type { StorePurchaseRequest } from '@boombapbot/contracts';
import { fetchLicenseFileForPurchase, type UpgradeFailure } from './client';
import { deviceLicense, type DeviceLicense } from './device-license';

/** A purchase as a store signed it, ready to show the server. */
export type StorePurchase = StorePurchaseRequest;

/** What buying came to: a purchase, the buyer backing out, or a purchase that waits on someone else's say. */
export type StoreBuy = { purchase: StorePurchase } | { stopped: 'cancelled' | 'pending' };

/**
 * The phone's store, as a shell that sells the upgrade there gives it to
 * the editor. The store takes the money and signs for it; the editor never
 * sees a card and never decides for itself that something was bought.
 */
export interface StoreBridge {
  /** The upgrade as the store lists it, with its price in the buyer's own money, or null when the store has none to sell. */
  product(): Promise<{ price: string } | null>;
  /** Asks the store to sell it, and comes back when the store's own sheet is done. */
  buy(): Promise<StoreBuy>;
  /**
   * The purchases of the upgrade the store says this buyer holds now: none
   * after a refund. `refresh` asks the store afresh, which may ask the buyer
   * to sign in, so it is for when they pressed "Restore purchases".
   */
  owned(refresh?: boolean): Promise<StorePurchase[]>;
  /** Tells `changed` when what the buyer holds may have changed with nobody pressing anything. Returns the way to stop. */
  watch?(changed: () => void): () => void;
}

/** What bringing a device in step with the store came to. */
export interface StoreSync {
  /** Whether the store says the buyer holds the upgrade. */
  held: boolean;
  /** What went wrong showing the purchase to the server, or null. */
  failure: UpgradeFailure | null;
}

const NOT_FOR_THIS_PROGRAM: UpgradeFailure = {
  message: 'The server gave a license file this app does not accept. Update the app, or try again in a minute.',
};

/**
 * Shows a purchase to the server and keeps the license file it answers
 * with. A purchase the server says was refunded locks a device it had
 * unlocked. Returns what went wrong, or null once the device holds the file.
 */
export async function unlockWithPurchase(
  baseUrl: string,
  purchase: StorePurchase,
  license: DeviceLicense = deviceLicense(),
): Promise<UpgradeFailure | null> {
  const asked = await fetchLicenseFileForPurchase(baseUrl, purchase);
  if (!asked.ok) {
    if (asked.failure.code === 'withdrawn') license.purchaseGone();
    return asked.failure;
  }
  return license.keep(asked.answer.file, 'store') ? null : NOT_FOR_THIS_PROGRAM;
}

/**
 * Brings the device in step with what the store says the buyer holds.
 * Nothing held: a device a purchase unlocked is locked again, which is what
 * a refund comes to. Something held: it is shown to the server, which
 * unlocks a device that was not, as after the app is installed again, and
 * puts the license onto the account that is logged in. A server that cannot
 * be reached leaves the device as it was.
 */
export async function syncWithStore(
  baseUrl: string,
  store: StoreBridge,
  refresh = false,
  license: DeviceLicense = deviceLicense(),
): Promise<StoreSync> {
  const [purchase] = await store.owned(refresh);
  if (!purchase) {
    license.purchaseGone();
    return { held: false, failure: null };
  }
  return { held: true, failure: await unlockWithPurchase(baseUrl, purchase, license) };
}

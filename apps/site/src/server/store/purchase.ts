/** A purchase of the upgrade that its store vouched for. */
export interface StorePurchase {
  store: 'apple' | 'google';
  /** What the store knows it by, the same when it is restored on another phone: Apple's original transaction id, Google's purchase token. */
  id: string;
  /** Bought in the store's sandbox or by one of its testers, where nothing is charged. */
  sandbox: boolean;
  /** The store has refunded it or taken it back. */
  revoked: boolean;
}

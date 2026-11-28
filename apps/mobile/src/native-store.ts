import type { PluginListenerHandle } from '@capacitor/core';
import type { StoreBridge, StorePurchase } from '@boombapbot/editor';

/** The name the plug-in in native-store/ registers under (`jsName`). */
export const STORE_PLUGIN = 'BoombapbotStore';
/** The event that says what the buyer holds may have changed with nobody pressing anything. */
export const CHANGED_EVENT = 'changed';

/** What the plug-in answers, as `registerPlugin` gives it, or a fake in tests. */
export interface StorePlugin {
  product(): Promise<{ price?: string }>;
  buy(): Promise<{ transaction?: string; stopped?: 'cancelled' | 'pending' }>;
  /** `refresh` asks the store afresh, which may ask the buyer to sign in: only when they pressed for it. */
  owned(options: { refresh: boolean }): Promise<{ transactions: string[] }>;
  addListener(event: typeof CHANGED_EVENT, listener: () => void): Promise<PluginListenerHandle>;
}

const applePurchase = (transaction: string): StorePurchase => ({ store: 'apple', transaction });

/** The App Store as the editor asks for a store: every purchase goes on as Apple signed it. */
export function appStore(plugin: StorePlugin): StoreBridge {
  return {
    async product() {
      const { price } = await plugin.product();
      return price ? { price } : null;
    },
    async buy() {
      const { transaction, stopped } = await plugin.buy();
      if (transaction) return { purchase: applePurchase(transaction) };
      return { stopped: stopped ?? 'cancelled' };
    },
    async owned(refresh = false) {
      const { transactions } = await plugin.owned({ refresh });
      return transactions.map(applePurchase);
    },
    watch(changed) {
      const listening = plugin.addListener(CHANGED_EVENT, changed);
      return () => void listening.then((handle) => handle.remove());
    },
  };
}

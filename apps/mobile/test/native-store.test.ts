import { readFileSync } from 'node:fs';
import { STORE_UPGRADE_PRODUCT } from '@boombapbot/contracts';
import { describe, expect, it } from 'vitest';
import { CHANGED_EVENT, STORE_PLUGIN, appStore, type StorePlugin } from '../src/native-store';

const swift = readFileSync(new URL('../native-store/ios/Sources/StorePlugin/StorePlugin.swift', import.meta.url), 'utf8');

/** A plug-in that answers what it is given, and remembers what it was asked. */
function plugin(answers: Partial<{ price: string; bought: Awaited<ReturnType<StorePlugin['buy']>>; transactions: string[] }>) {
  const asked: unknown[] = [];
  const listeners: Array<() => void> = [];
  let removed = 0;
  const fake: StorePlugin = {
    product: async () => (answers.price ? { price: answers.price } : {}),
    buy: async () => answers.bought ?? {},
    owned: async (options) => {
      asked.push(options);
      return { transactions: answers.transactions ?? [] };
    },
    addListener: async (_event, listener) => {
      listeners.push(listener);
      return { remove: async () => void (removed += 1) };
    },
  };
  return { fake, asked, listeners, removed: () => removed };
}

describe('the App Store, as the editor asks for a store', () => {
  it('gives the price the store gives, and null when the store lists nothing', async () => {
    expect(await appStore(plugin({ price: '4,99 €' }).fake).product()).toEqual({ price: '4,99 €' });
    expect(await appStore(plugin({}).fake).product()).toBeNull();
  });

  it('hands on a purchase as Apple signed it, and says when there was none', async () => {
    const bought = await appStore(plugin({ bought: { transaction: 'signed' } }).fake).buy();
    expect(bought).toEqual({ purchase: { store: 'apple', transaction: 'signed' } });
    expect(await appStore(plugin({ bought: { stopped: 'pending' } }).fake).buy()).toEqual({ stopped: 'pending' });
    expect(await appStore(plugin({ bought: { stopped: 'cancelled' } }).fake).buy()).toEqual({ stopped: 'cancelled' });
    expect(await appStore(plugin({}).fake).buy()).toEqual({ stopped: 'cancelled' });
  });

  it('asks the store afresh only when told to', async () => {
    const { fake, asked } = plugin({ transactions: ['one', 'two'] });
    const store = appStore(fake);
    expect(await store.owned()).toEqual([
      { store: 'apple', transaction: 'one' },
      { store: 'apple', transaction: 'two' },
    ]);
    await store.owned(true);
    expect(asked).toEqual([{ refresh: false }, { refresh: true }]);
  });

  it('passes on the store’s word that something changed, until told to stop', async () => {
    const { fake, listeners, removed } = plugin({});
    let heard = 0;
    const stop = appStore(fake).watch?.(() => void (heard += 1));
    await Promise.resolve();
    listeners[0]?.();
    expect(heard).toBe(1);
    stop?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(removed()).toBe(1);
  });
});

describe('the Swift plug-in', () => {
  it('registers under the name the page asks for, with the calls and the event the page uses', () => {
    expect(swift).toContain(`jsName = "${STORE_PLUGIN}"`);
    for (const call of ['product', 'buy', 'owned']) expect(swift).toContain(`CAPPluginMethod(name: "${call}"`);
    expect(swift).toContain(`changedEvent = "${CHANGED_EVENT}"`);
  });

  it('sells the product the server accepts', () => {
    expect(swift).toContain(`upgrade = "${STORE_UPGRADE_PRODUCT}"`);
  });

  it('is the one Swift file in its package that names a class to Objective-C', () => {
    expect(swift.match(/@objc\(/g)).toHaveLength(1);
  });
});

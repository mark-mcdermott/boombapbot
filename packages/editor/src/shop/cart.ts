import { CartSchema, MAX_CART_LINES, MAX_LINE_QUANTITY, type Cart } from '@boombapbot/contracts';
import { useSyncExternalStore } from 'react';
import { browserStorage } from '../state/draft-storage';

const CART_KEY = 'boombapbot.cart.v1';
const EMPTY: Cart = [];
const listeners = new Set<() => void>();
let lines: Cart | null = null;

/** The saved cart, or an empty one if nothing usable was saved. */
function saved(): Cart {
  const text = browserStorage()?.getItem(CART_KEY);
  if (!text) return EMPTY;
  try {
    const parsed = CartSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

function read(): Cart {
  lines ??= saved();
  return lines;
}

function write(next: Cart): void {
  lines = next;
  browserStorage()?.setItem(CART_KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The cart, kept in this browser. A line is a variant and how many of it. */
export const cart = {
  add(variantId: string): void {
    const current = read();
    const line = current.find((candidate) => candidate.variantId === variantId);
    if (line) cart.setQuantity(variantId, line.quantity + 1);
    else if (current.length < MAX_CART_LINES) write([...current, { variantId, quantity: 1 }]);
  },
  /** Zero takes the line out. */
  setQuantity(variantId: string, quantity: number): void {
    const wanted = Math.min(quantity, MAX_LINE_QUANTITY);
    write(
      read().flatMap((line) => {
        if (line.variantId !== variantId) return [line];
        return wanted > 0 ? [{ variantId, quantity: wanted }] : [];
      }),
    );
  },
  clear(): void {
    write(EMPTY);
  },
};

export function useCart(): Cart {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

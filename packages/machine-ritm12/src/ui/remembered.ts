import { useSyncExternalStore } from 'react';
import { browserStorage } from '@boombapbot/editor';

/** A choice between a few named things that this device remembers, the same in every tab. */
export interface Remembered<Choice extends string> {
  set(next: Choice): void;
  use(): Choice;
}

/**
 * A choice kept under `key`. `usual` is what it is until someone chooses
 * otherwise, and is stored as nothing at all.
 */
export function remembered<Choice extends string>(key: string, usual: Choice, others: readonly Choice[]): Remembered<Choice> {
  const listeners = new Set<() => void>();
  let now: Choice | null = null;

  const stored = (): Choice => {
    const kept = browserStorage()?.getItem(key);
    return others.find((other) => other === kept) ?? usual;
  };
  const current = (): Choice => {
    now ??= stored();
    return now;
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      now = stored();
      listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  };

  return {
    set(next) {
      now = next;
      const storage = browserStorage();
      if (next === usual) storage?.removeItem(key);
      else storage?.setItem(key, next);
      listeners.forEach((listener) => listener());
    },
    use: () => useSyncExternalStore(subscribe, current, () => usual),
  };
}

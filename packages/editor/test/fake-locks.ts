import type { TabLocks } from '../src/state/draft-tabs';

/** Web Locks for one browser in a test: exclusive, with `ifAvailable` and `steal`. */
export class FakeLocks implements TabLocks {
  private readonly held = new Map<string, { stolen: (error: Error) => void }>();

  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown> {
    const holder = this.held.get(name);
    if (holder && options.ifAvailable) return Promise.resolve(callback(null));
    if (holder && !options.steal) throw new Error('a waiting request is not needed by these tests');
    if (holder) {
      this.held.delete(name);
      holder.stolen(new DOMException('The lock was stolen.', 'AbortError'));
    }
    return new Promise((resolve, reject) => {
      const entry = { stolen: reject };
      this.held.set(name, entry);
      Promise.resolve(callback({ name })).then(
        () => {
          if (this.held.get(name) === entry) this.held.delete(name);
          resolve(undefined);
        },
        reject,
      );
    });
  }

  isHeld(name: string): boolean {
    return this.held.has(name);
  }
}

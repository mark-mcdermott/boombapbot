import { afterEach, describe, expect, it } from 'vitest';
import { claimTab, type TabClaim, type TabEnvironment } from '../src/state/draft-tabs';
import { FakeLocks } from './fake-locks';

let names = 0;
const claims: TabClaim[] = [];

/** A draft name no other test uses, since BroadcastChannel reaches the whole process. */
const draftName = () => `test-draft-${(names += 1)}`;

async function tab(name: string, env: TabEnvironment, letGo: () => Promise<void> = () => Promise.resolve()) {
  const claim = await claimTab(name, letGo, env);
  claims.push(claim);
  return claim;
}

const channel = (name: string) => new BroadcastChannel(name);

afterEach(() => {
  for (const claim of claims.splice(0)) claim.close();
});

describe('with Web Locks and a channel', () => {
  it('gives the draft to the first tab and not the second', async () => {
    const name = draftName();
    const env = { locks: new FakeLocks(), openChannel: channel, answerWithin: 200 };
    expect((await tab(name, env)).here).toBe(true);
    expect((await tab(name, env)).here).toBe(false);
  });

  it('has the owner write what it has before the asking tab owns the draft', async () => {
    const name = draftName();
    const env = { locks: new FakeLocks(), openChannel: channel, answerWithin: 1000 };
    const order: string[] = [];
    const first = await tab(name, env, async () => {
      order.push('first writes');
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('first done');
    });
    const second = await tab(name, env);
    const told: boolean[] = [];
    first.subscribe((here) => told.push(here));
    second.subscribe((here) => here && order.push('second owns'));

    await second.takeOver();
    expect(order).toEqual(['first writes', 'first done', 'second owns']);
    expect(first.here).toBe(false);
    expect(second.here).toBe(true);
    expect(told).toEqual([false]);
  });

  it('lets a new tab have the draft once the owner is closed', async () => {
    const name = draftName();
    const locks = new FakeLocks();
    const env = { locks, openChannel: channel, answerWithin: 200 };
    const first = await tab(name, env);
    first.close();
    await Promise.resolve();
    expect(locks.isHeld(name)).toBe(false);
    expect((await tab(name, env)).here).toBe(true);
  });

  it('has the draft at once when the owner has closed since', async () => {
    const name = draftName();
    const env = { locks: new FakeLocks(), openChannel: channel, answerWithin: 5000 };
    const first = await tab(name, env);
    const second = await tab(name, env);
    first.close();
    await Promise.resolve();
    const started = Date.now();
    await second.takeOver();
    expect(second.here).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('takes the draft from an owner that does not answer', async () => {
    const name = draftName();
    const locks = new FakeLocks();
    // The owner has no channel, so it never hears the request.
    const first = await tab(name, { locks, openChannel: null });
    const second = await tab(name, { locks, openChannel: channel, answerWithin: 50 });
    expect(second.here).toBe(false);
    await second.takeOver();
    await Promise.resolve();
    expect(second.here).toBe(true);
    expect(first.here).toBe(false);
  });
});

describe('without Web Locks', () => {
  it('settles the owner over the channel alone', async () => {
    const name = draftName();
    const env = { locks: null, openChannel: channel, answerWithin: 100 };
    const first = await tab(name, env);
    const second = await tab(name, env);
    expect(first.here).toBe(true);
    expect(second.here).toBe(false);
    await second.takeOver();
    expect(second.here).toBe(true);
    expect(first.here).toBe(false);
  });

  it('lets every tab keep its own draft with no channel either, as before', async () => {
    const name = draftName();
    const env = { locks: null, openChannel: null };
    expect((await tab(name, env)).here).toBe(true);
    expect((await tab(name, env)).here).toBe(true);
  });
});

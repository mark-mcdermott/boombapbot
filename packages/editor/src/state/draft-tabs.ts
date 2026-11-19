/**
 * Which tab keeps a machine's draft. One tab owns it and writes it; any other
 * tab that opens it is told so and writes nothing until asked to work there
 * instead. Then the owner writes what it has, lets go, and the asking tab
 * takes over. A tab is never handed the draft without asking for it.
 *
 * Web Locks hold the ownership and a BroadcastChannel carries the hand-over.
 * Without Web Locks the channel alone settles it; with neither, every tab
 * owns its draft, as before there was a rule.
 */

/** The part of Web Locks this needs. `navigator.locks` is one. */
export interface TabLocks {
  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown>;
}

/** The part of a BroadcastChannel this needs. */
export interface TabChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface TabEnvironment {
  locks: TabLocks | null;
  openChannel: ((name: string) => TabChannel) | null;
  /** How long to wait for the owner to answer, in ms. */
  answerWithin?: number;
}

export interface TabClaim {
  /** Whether this tab owns the draft. */
  readonly here: boolean;
  /** Called when ownership moves to or from this tab. */
  subscribe(listener: (here: boolean) => void): () => void;
  /** Asks the owner to let go, then owns the draft here. */
  takeOver(): Promise<void>;
  close(): void;
}

type MessageType = 'take' | 'released' | 'who' | 'mine';

interface TabMessage {
  type: MessageType;
  tab: string;
}

const ANSWER_WITHIN_MS = 1500;

function isTabMessage(value: unknown): value is TabMessage {
  if (typeof value !== 'object' || value === null) return false;
  const { type, tab } = value as Partial<TabMessage>;
  return typeof tab === 'string' && (type === 'take' || type === 'released' || type === 'who' || type === 'mine');
}

export function browserTabs(): TabEnvironment {
  const locks = typeof navigator !== 'undefined' ? (navigator.locks ?? null) : null;
  return {
    locks,
    openChannel: typeof BroadcastChannel === 'function' ? (name) => new BroadcastChannel(name) : null,
  };
}

/**
 * Claims the draft named `name` for this tab if no other tab owns it.
 * `letGo` is awaited before ownership passes to another tab, to write what
 * this one has.
 */
export async function claimTab(
  name: string,
  letGo: () => Promise<void>,
  env: TabEnvironment = browserTabs(),
): Promise<TabClaim> {
  const tab = Math.random().toString(36).slice(2);
  const answerWithin = env.answerWithin ?? ANSWER_WITHIN_MS;
  const channel = env.openChannel?.(name) ?? null;
  const listeners = new Set<(here: boolean) => void>();
  const waiting = new Map<MessageType, Set<() => void>>();
  let here = false;
  let release: (() => void) | null = null;

  const set = (value: boolean): void => {
    if (here === value) return;
    here = value;
    for (const listener of listeners) listener(value);
  };

  const post = (type: MessageType): void => channel?.postMessage({ type, tab } satisfies TabMessage);

  /** Resolves true when another tab sends `type`, false when none does in time. */
  const heard = (type: MessageType): Promise<boolean> =>
    new Promise((resolve) => {
      const answers = waiting.get(type) ?? new Set();
      waiting.set(type, answers);
      const answered = (): void => {
        clearTimeout(timer);
        answers.delete(answered);
        resolve(true);
      };
      const timer = setTimeout(() => {
        answers.delete(answered);
        resolve(false);
      }, answerWithin);
      answers.add(answered);
    });

  /** Takes the lock, or with `steal` takes it from whichever tab holds it. Resolves whether it is held. */
  const hold = (locks: TabLocks, steal: boolean): Promise<boolean> =>
    new Promise((resolve) => {
      let granted = false;
      locks
        .request(name, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
          if (lock === null) {
            resolve(false);
            return;
          }
          granted = true;
          resolve(true);
          return new Promise<void>((done) => {
            release = done;
          });
        })
        .catch(() => {
          if (!granted) {
            // Web Locks refused outright: carry on as a tab on its own.
            resolve(true);
            return;
          }
          // Another tab stole it without asking first.
          release = null;
          set(false);
        });
    });

  const giveUp = async (): Promise<void> => {
    set(false);
    try {
      await letGo();
    } finally {
      release?.();
      release = null;
      post('released');
    }
  };

  channel?.addEventListener('message', (event) => {
    const message: unknown = event.data;
    if (!isTabMessage(message) || message.tab === tab) return;
    if (message.type === 'take' && here) void giveUp();
    else if (message.type === 'who' && here) post('mine');
    for (const answered of [...(waiting.get(message.type) ?? [])]) answered();
  });

  if (env.locks) {
    set(await hold(env.locks, false));
  } else if (channel) {
    const owned = heard('mine');
    post('who');
    set(!(await owned));
  } else {
    set(true);
  }

  return {
    get here() {
      return here;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async takeOver() {
      if (here) return;
      // The tab that owned it may have closed since.
      if (env.locks && (await hold(env.locks, false))) {
        set(true);
        return;
      }
      if (channel) {
        const released = heard('released');
        post('take');
        await released;
      }
      if (env.locks) await hold(env.locks, true);
      set(true);
    },
    close() {
      release?.();
      release = null;
      channel?.close();
      listeners.clear();
    },
  };
}

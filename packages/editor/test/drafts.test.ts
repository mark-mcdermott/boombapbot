import { createProjectCodec, type DocumentKind } from '@boombapbot/contracts';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorRuntime } from '../src/runtime';
import { openDraftDatabase, type DraftDatabase } from '../src/state/draft-database';
import type { KeyValueStorage } from '../src/state/draft-storage';
import type { TabEnvironment } from '../src/state/draft-tabs';
import { openBrowserDrafts, type BrowserDraftOptions, type Drafts, type PageLife } from '../src/state/drafts';
import { FakeLocks } from './fake-locks';
import { testMachine, type TestProject } from './test-machine';

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const kind = testMachine.document;
const codec = createProjectCodec([kind]);
const beat = (id: string, tempo = 120): TestProject => ({
  ...kind.create({ id, now: new Date('2026-11-01T00:00:00Z') }),
  tempo,
});
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A page that is hidden when the test says so. */
function fakePage(): PageLife & { hide(): void } {
  const listeners = new Set<() => void>();
  return {
    onHide(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hide: () => listeners.forEach((listener) => listener()),
  };
}

/** Each test its own browser: a database, localStorage and tabs nobody else shares. */
function browser() {
  const factory = new IDBFactory();
  const local = new MemoryStorage();
  const locks = new FakeLocks();
  const tabs: TabEnvironment = { locks, openChannel: (name) => new BroadcastChannel(name), answerWithin: 200 };
  const opened: Array<Drafts<TestProject>> = [];
  const open = async (options: BrowserDraftOptions = {}, documentKind: DocumentKind<TestProject> = kind) => {
    const drafts = await openBrowserDrafts(documentKind, codec, {
      open: () => openDraftDatabase(factory),
      local,
      tabs,
      page: null,
      ...options,
    });
    opened.push(drafts);
    return drafts;
  };
  const closeAll = async () => {
    for (const drafts of opened.splice(0)) {
      drafts.close();
      await drafts.flush();
    }
  };
  return { factory, local, open, closeAll };
}

/** Resolves with the outcome of the next write. */
const nextWrite = (drafts: Drafts<TestProject>) =>
  new Promise<boolean>((resolve) => {
    const stop = drafts.onWrite((ok) => {
      stop();
      resolve(ok);
    });
  });

let current: ReturnType<typeof browser> | null = null;
const fresh = () => (current = browser());

afterEach(async () => {
  await current?.closeAll();
  current = null;
  vi.restoreAllMocks();
});

describe('drafts in IndexedDB', () => {
  it('keeps the draft by project id and opens it again', async () => {
    const { open, closeAll } = fresh();
    const first = await open();
    expect(first.loaded.status).toBe('empty');
    first.write(beat('beat-a', 97));
    await first.flush();
    await closeAll();

    const again = await open();
    expect(again.loaded).toMatchObject({ status: 'restored', project: { id: 'beat-a', tempo: 97 } });
  });

  it('keeps an earlier project when the machine moves to another, and opens the newest', async () => {
    const { factory, open, closeAll } = fresh();
    const drafts = await open();
    drafts.write(beat('beat-a', 90));
    await drafts.flush();
    drafts.write(beat('beat-b', 140));
    await drafts.flush();
    await closeAll();

    const db = await openDraftDatabase(factory);
    expect((await db.current(kind.draftKey))?.id).toBe('beat-b');
    db.close();
    expect((await open()).loaded).toMatchObject({ project: { id: 'beat-b', tempo: 140 } });
    const records = await new Promise<unknown[]>((resolve) => {
      const request = factory.open('boombapbot');
      request.onsuccess = () => {
        const all = request.result.transaction('drafts').objectStore('drafts').getAll();
        all.onsuccess = () => {
          resolve(all.result);
          request.result.close();
        };
      };
    });
    expect(records.map((record) => (record as { id: string }).id).sort()).toEqual(['beat-a', 'beat-b']);
  });

  it('writes once after a run of changes, not once a change', async () => {
    const { open } = fresh();
    const drafts = await open({ quietMs: 40, mostMs: 1000 });
    const outcomes: boolean[] = [];
    drafts.onWrite((ok) => outcomes.push(ok));
    for (let tempo = 100; tempo < 110; tempo += 1) {
      drafts.write(beat('beat-a', tempo));
      await pause(5);
    }
    expect(outcomes).toEqual([]);
    await pause(150);
    expect(outcomes).toEqual([true]);
    await drafts.flush();
    expect(outcomes).toEqual([true]);
  });

  it('writes during a long drag, not only once it stops', async () => {
    const { open } = fresh();
    const drafts = await open({ quietMs: 40, mostMs: 80 });
    const outcomes: boolean[] = [];
    drafts.onWrite((ok) => outcomes.push(ok));
    for (let tempo = 100; tempo < 130; tempo += 1) {
      drafts.write(beat('beat-a', tempo));
      await pause(10);
    }
    expect(outcomes.length).toBeGreaterThanOrEqual(2);
  });

  it('writes at once when the page is hidden or closed', async () => {
    const { open, closeAll } = fresh();
    const page = fakePage();
    const drafts = await open({ page, quietMs: 60_000, mostMs: 60_000 });
    const written = nextWrite(drafts);
    drafts.write(beat('beat-a', 133));
    page.hide();
    expect(await written).toBe(true);
    await closeAll();
    expect((await open()).loaded).toMatchObject({ project: { tempo: 133 } });
  });

  it('reports a write IndexedDB refuses', async () => {
    const { factory, open } = fresh();
    const drafts = await open({
      open: async () => {
        const db = await openDraftDatabase(factory);
        return { ...db, put: () => Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError')) };
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const written = nextWrite(drafts);
    drafts.write(beat('beat-a'));
    await drafts.flush();
    expect(await written).toBe(false);
  });

  it('sets an unreadable draft aside and opens empty after', async () => {
    const { factory, open, closeAll } = fresh();
    const db = await openDraftDatabase(factory);
    await db.put(kind.draftKey, { id: 'beat-a', text: '{"format":"boombapbot.project", broken' });
    db.close();
    expect((await open()).loaded.status).toBe('unreadable');
    await closeAll();
    expect((await open()).loaded.status).toBe('empty');
  });
});

describe('moving a draft out of localStorage', () => {
  it('moves it across on first opening, and removes the old copy once IndexedDB has it', async () => {
    const { local, open, closeAll } = fresh();
    local.setItem(kind.draftKey, JSON.stringify(beat('beat-old', 88)));
    expect((await open()).loaded).toMatchObject({ status: 'restored', project: { id: 'beat-old', tempo: 88 } });
    expect(local.getItem(kind.draftKey)).toBeNull();
    await closeAll();
    expect((await open({ local: null })).loaded).toMatchObject({ project: { id: 'beat-old', tempo: 88 } });
  });

  it('leaves the old copy where it is when IndexedDB will not take it', async () => {
    const { factory, local, open } = fresh();
    const text = JSON.stringify(beat('beat-old', 88));
    local.setItem(kind.draftKey, text);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refusing = async (): Promise<DraftDatabase> => ({
      ...(await openDraftDatabase(factory)),
      put: () => Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError')),
    });
    expect((await open({ open: refusing })).loaded).toMatchObject({ status: 'restored', project: { tempo: 88 } });
    expect(local.getItem(kind.draftKey)).toBe(text);
  });

  it('reads a draft an earlier version left, and leaves it where it is', async () => {
    const { local, open, closeAll } = fresh();
    const earlier = { ...kind, earlierDraftKeys: ['boombapbot.test.draft.v0'] };
    const text = JSON.stringify(beat('beat-earlier', 101));
    local.setItem('boombapbot.test.draft.v0', text);
    const drafts = await open({}, earlier);
    expect(drafts.loaded).toMatchObject({ status: 'restored', project: { tempo: 101 } });
    drafts.write(beat('beat-earlier', 101));
    await drafts.flush();
    await closeAll();
    expect(local.getItem('boombapbot.test.draft.v0')).toBe(text);
    local.removeItem('boombapbot.test.draft.v0');
    expect((await open({}, earlier)).loaded).toMatchObject({ project: { tempo: 101 } });
  });

  it('sets an unreadable draft aside in IndexedDB, then removes it from localStorage', async () => {
    const { local, open, closeAll } = fresh();
    local.setItem(kind.draftKey, 'not a project');
    expect((await open()).loaded.status).toBe('unreadable');
    expect(local.getItem(kind.draftKey)).toBeNull();
    await closeAll();
    expect((await open()).loaded.status).toBe('empty');
  });
});

describe('a browser that cannot keep a draft in IndexedDB', () => {
  const blocked = () => Promise.reject(new DOMException('The operation is insecure.', 'SecurityError'));

  it('keeps nothing, and still shows a draft left in localStorage without removing it', async () => {
    const { local, open } = fresh();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const text = JSON.stringify(beat('beat-old', 77));
    local.setItem(kind.draftKey, text);
    const drafts = await open({ open: blocked });
    expect(drafts.kept).toBe(false);
    expect(drafts.loaded).toMatchObject({ status: 'restored', project: { tempo: 77 } });
    expect(local.getItem(kind.draftKey)).toBe(text);
  });

  it('takes the editor down the path that says it is not saving drafts', async () => {
    const { open } = fresh();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const drafts = await open({ open: blocked });
    const runtime = new EditorRuntime({ baseUrl: '/', machine: testMachine, drafts });
    expect(runtime.store.getState().draftState).toBe('error');
  });
});

describe('two tabs on one draft', () => {
  const editor = (drafts: Drafts<TestProject>) => {
    const runtime = new EditorRuntime({ baseUrl: '/', machine: testMachine, drafts });
    runtime.attach();
    return runtime;
  };
  const setTempo = (runtime: EditorRuntime<TestProject>, tempo: number) =>
    runtime.store.adjust({ ...runtime.store.getState().project, tempo });

  it('lets the first tab keep the draft and tells the second', async () => {
    const { open } = fresh();
    const first = editor(await open());
    const second = editor(await open());
    expect(first.store.getState().draftState).toBe('saved');
    expect(second.store.getState().draftState).toBe('elsewhere');
    first.detach();
    second.detach();
  });

  it('writes nothing from the second tab', async () => {
    const { open, closeAll } = fresh();
    const firstDrafts = await open();
    const first = editor(firstDrafts);
    setTempo(first, 111);
    await firstDrafts.flush();
    const secondDrafts = await open();
    const second = editor(secondDrafts);
    setTempo(second, 155);
    await secondDrafts.flush();
    first.detach();
    second.detach();
    await closeAll();
    expect((await open()).loaded).toMatchObject({ project: { tempo: 111 } });
  });

  it('moves the draft to the second tab when asked, with the first tab’s changes and an undo back', async () => {
    const { open, closeAll } = fresh();
    const firstDrafts = await open({ quietMs: 60_000, mostMs: 60_000 });
    const first = editor(firstDrafts);
    const second = editor(await open());
    setTempo(second, 155);
    // Still waiting to be written when the second tab asks: the first writes it before letting go.
    setTempo(first, 123);

    await second.workHere();
    expect(second.store.getState().draftState).toBe('saved');
    expect(first.store.getState().draftState).toBe('elsewhere');
    expect(second.store.getState().project.tempo).toBe(123);
    expect(second.store.getState().notice?.message).toContain('Undo brings back what was here');
    second.store.undo();
    expect(second.store.getState().project.tempo).toBe(155);

    // From now on only the second tab writes.
    setTempo(first, 60);
    second.store.redo();
    setTempo(second, 170);
    first.detach();
    second.detach();
    await closeAll();
    expect((await open()).loaded).toMatchObject({ project: { tempo: 170 } });
  });

  it('says only that the tab saves it now when nothing differs', async () => {
    const { factory, open } = fresh();
    const db = await openDraftDatabase(factory);
    await db.put(kind.draftKey, { id: 'beat-a', text: JSON.stringify(beat('beat-a')) });
    db.close();
    const first = editor(await open());
    const second = editor(await open());
    await second.workHere();
    expect(second.store.getState().notice?.message).toBe('This tab is saving the beat now.');
    expect(second.store.getState().canUndo).toBe(false);
    first.detach();
    second.detach();
  });
});

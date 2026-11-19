import type { DocumentKind, ProjectBase, ProjectCodec } from '@boombapbot/contracts';
import { describe } from '../engine/engine-audio';
import { openDraftDatabase, type DraftDatabase } from './draft-database';
import {
  browserStorage,
  draftLoadOf,
  loadDraft,
  saveDraft,
  type DraftLoad,
  type KeyValueStorage,
} from './draft-storage';
import { browserTabs, claimTab, type TabEnvironment } from './draft-tabs';

/** Where the editor keeps its draft, as it opened it. */
export interface Drafts<Document extends ProjectBase> {
  /** The draft found on opening. */
  readonly loaded: DraftLoad<Document>;
  /** False when nothing can be kept, so the editor says it is not saving drafts. */
  readonly kept: boolean;
  /** Which tab keeps the draft when tabs share it. Null where a shell keeps it in its own store. */
  readonly tab: DraftTab<Document> | null;
  /** Keeps the project as the draft, now or shortly. */
  write(project: Document): void;
  /** Writes anything still waiting. Resolves once it is written or has failed. */
  flush(): Promise<void>;
  /** Called with each write's outcome. */
  onWrite(listener: (ok: boolean) => void): () => void;
  close(): void;
}

export interface DraftTab<Document extends ProjectBase> {
  /** Whether this tab owns the draft and writes it. */
  readonly here: boolean;
  subscribe(listener: (here: boolean) => void): () => void;
  /** Asks the tab that owns the draft to let go, owns it here, and hands back the newest draft kept. */
  takeOver(): Promise<DraftLoad<Document>>;
}

/** When the page is going away or out of sight, and a waiting write should go now. */
export interface PageLife {
  onHide(listener: () => void): () => void;
}

export interface BrowserDraftOptions {
  /** Opens the database. The browser's IndexedDB when not given. */
  open?: () => Promise<DraftDatabase>;
  /** Where the editor kept its draft before IndexedDB, read once to move it across. */
  local?: KeyValueStorage | null;
  tabs?: TabEnvironment;
  page?: PageLife | null;
  /** A write waits for this long without a change… */
  quietMs?: number;
  /** …but never longer than this after the first change it holds. */
  mostMs?: number;
}

const QUIET_MS = 400;
const MOST_MS = 2000;

const EMPTY = { status: 'empty' } as const;

function listeners<Value>() {
  const all = new Set<(value: Value) => void>();
  return {
    add(listener: (value: Value) => void): () => void {
      all.add(listener);
      return () => all.delete(listener);
    },
    emit(value: Value): void {
      for (const listener of all) listener(value);
    },
  };
}

/** A shell's own synchronous store: read on opening, written on every change. */
export function keyValueDrafts<Document extends ProjectBase>(
  storage: KeyValueStorage,
  kind: DocumentKind<Document>,
  codec: ProjectCodec<Document>,
): Drafts<Document> {
  const writes = listeners<boolean>();
  return {
    loaded: loadDraft(storage, kind, codec),
    kept: true,
    tab: null,
    write: (project) => writes.emit(saveDraft(storage, kind, project).ok),
    flush: () => Promise.resolve(),
    onWrite: writes.add,
    close: () => undefined,
  };
}

/** Nowhere to keep a draft. What was found on opening, if anything, can still be shown. */
export function noDrafts<Document extends ProjectBase>(loaded: DraftLoad<Document> = EMPTY): Drafts<Document> {
  return {
    loaded,
    kept: false,
    tab: null,
    write: () => undefined,
    flush: () => Promise.resolve(),
    onWrite: () => () => undefined,
    close: () => undefined,
  };
}

/**
 * The browser's own drafts, in IndexedDB. Writes wait for a pause, and go at
 * once when the page is hidden or closed. A draft the editor left in
 * localStorage is moved across on first opening, and the old copy removed
 * only once IndexedDB has it. Without IndexedDB nothing is kept.
 */
export async function openBrowserDrafts<Document extends ProjectBase>(
  kind: DocumentKind<Document>,
  codec: ProjectCodec<Document>,
  options: BrowserDraftOptions = {},
): Promise<Drafts<Document>> {
  const local = options.local === undefined ? browserStorage() : options.local;
  let db: DraftDatabase;
  let loaded: DraftLoad<Document>;
  try {
    db = await (options.open ?? openDraftDatabase)();
    loaded = await loadFromDatabase(db, kind, codec, local);
  } catch (error) {
    console.error('IndexedDB could not be opened, so no draft is kept.', error);
    return noDrafts(local ? readOnly(local, kind, codec) : EMPTY);
  }

  const quietMs = options.quietMs ?? QUIET_MS;
  const mostMs = options.mostMs ?? MOST_MS;
  const writes = listeners<boolean>();
  let pending: Document | null = null;
  let firstPendingAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const project = pending;
    if (project) {
      pending = null;
      const draft = { id: project.id, text: kind.serialize(project) };
      writing = writing
        .then(() => db.put(kind.draftKey, draft))
        .then(
          () => writes.emit(true),
          (error: unknown) => {
            console.error('The draft could not be written.', error);
            writes.emit(false);
          },
        );
    }
    return writing;
  };

  const claim = await claimTab(`boombapbot.draft:${kind.draftKey}`, flush, options.tabs ?? browserTabs());
  const page = options.page === undefined ? browserPage() : options.page;
  const stopWatching = page?.onHide(() => void flush());

  return {
    loaded,
    kept: true,
    tab: {
      get here() {
        return claim.here;
      },
      subscribe: (listener) => claim.subscribe(listener),
      async takeOver() {
        await claim.takeOver();
        try {
          return await loadFromDatabase(db, kind, codec, null);
        } catch (error) {
          return { status: 'unavailable', errors: [describe(error)] };
        }
      },
    },
    write(project) {
      if (!claim.here) return;
      const now = Date.now();
      if (!pending) firstPendingAt = now;
      pending = project;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void flush(), Math.max(0, Math.min(quietMs, firstPendingAt + mostMs - now)));
    },
    flush,
    onWrite: writes.add,
    close() {
      stopWatching?.();
      claim.close();
      void flush().finally(() => db.close());
    },
  };
}

const opened = new Map<string, Promise<unknown>>();

/**
 * The browser's drafts for a machine, opened once for the page however many
 * editors ask, so that a page claims its draft once.
 */
export function pageDrafts<Document extends ProjectBase>(
  kind: DocumentKind<Document>,
  codec: ProjectCodec<Document>,
): Promise<Drafts<Document>> {
  let drafts = opened.get(kind.draftKey) as Promise<Drafts<Document>> | undefined;
  if (!drafts) {
    drafts = openBrowserDrafts(kind, codec);
    opened.set(kind.draftKey, drafts);
  }
  return drafts;
}

async function loadFromDatabase<Document extends ProjectBase>(
  db: DraftDatabase,
  kind: DocumentKind<Document>,
  codec: ProjectCodec<Document>,
  local: KeyValueStorage | null,
): Promise<DraftLoad<Document>> {
  const stored = await db.current(kind.draftKey);
  if (!stored) return local ? moveAcross(db, kind, codec, local) : EMPTY;
  const loaded = draftLoadOf(codec.parseText(stored.text));
  if (loaded.status === 'unreadable') {
    await db.setAside(kind.draftKey, stored.text, stored.id).catch((error: unknown) => {
      console.error('The unreadable draft could not be set aside.', error);
    });
  }
  return loaded;
}

/**
 * Moves the draft this machine kept in localStorage into IndexedDB, then
 * removes the old copy. A draft an earlier version left is read where it is
 * and never moved or removed; the editor's first write keeps it here.
 */
async function moveAcross<Document extends ProjectBase>(
  db: DraftDatabase,
  kind: DocumentKind<Document>,
  codec: ProjectCodec<Document>,
  local: KeyValueStorage,
): Promise<DraftLoad<Document>> {
  const found = readLocal(local, kind);
  if (!found) return EMPTY;
  const result = codec.parseText(found.text);
  if (found.key === kind.draftKey) {
    try {
      if (result.ok) await db.put(kind.draftKey, { id: result.project.id, text: found.text });
      else await db.setAside(kind.draftKey, found.text);
      local.removeItem(found.key);
    } catch (error) {
      // The old copy stays where it is until IndexedDB has it.
      console.error('The draft could not be moved to IndexedDB.', error);
    }
  }
  return draftLoadOf(result);
}

function readLocal<Document extends ProjectBase>(
  local: KeyValueStorage,
  kind: DocumentKind<Document>,
): { key: string; text: string } | null {
  try {
    for (const key of [kind.draftKey, ...kind.earlierDraftKeys]) {
      const text = local.getItem(key);
      if (text !== null) return { key, text };
    }
  } catch {
    // Storage that cannot be read has nothing to move.
  }
  return null;
}

/** A draft left in localStorage, shown when IndexedDB cannot keep it. Nothing is moved or removed. */
function readOnly<Document extends ProjectBase>(
  local: KeyValueStorage,
  kind: DocumentKind<Document>,
  codec: ProjectCodec<Document>,
): DraftLoad<Document> {
  const found = readLocal(local, kind);
  return found ? draftLoadOf(codec.parseText(found.text)) : EMPTY;
}

function browserPage(): PageLife | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  return {
    onHide(listener) {
      const hidden = (): void => {
        if (document.visibilityState === 'hidden') listener();
      };
      window.addEventListener('pagehide', listener);
      document.addEventListener('visibilitychange', hidden);
      return () => {
        window.removeEventListener('pagehide', listener);
        document.removeEventListener('visibilitychange', hidden);
      };
    },
  };
}

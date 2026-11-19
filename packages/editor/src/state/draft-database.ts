const DATABASE_NAME = 'boombapbot';
const DATABASE_VERSION = 1;
/** Every draft kept, by project id: { id, kind, text, savedAt }. */
const DRAFTS = 'drafts';
/** The project each machine is working on, by the machine's draft key. */
const CURRENT = 'current';
/** Drafts that failed validation, kept so nothing is silently discarded. */
const UNREADABLE = 'unreadable';

export interface StoredDraft {
  /** The project's id. */
  id: string;
  text: string;
}

interface DraftRecord extends StoredDraft {
  kind: string;
  savedAt: number;
}

/**
 * The drafts in the browser's IndexedDB, keyed by project id. A machine works
 * on one at a time, which `current` names; the others stay where they are.
 */
export interface DraftDatabase {
  /** The draft a machine is working on, or null when it has none. */
  current(kind: string): Promise<StoredDraft | null>;
  /** Writes a draft and makes it the one the machine is working on. Resolves once it is committed. */
  put(kind: string, draft: StoredDraft): Promise<void>;
  /** Moves a draft that cannot be read out of the way, keeping its text. */
  setAside(kind: string, text: string, id?: string): Promise<void>;
  close(): void;
}

/** Opens the database, or rejects when the browser has none or refuses it (blocked storage). */
export async function openDraftDatabase(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<DraftDatabase> {
  if (!factory) throw new Error('This browser has no IndexedDB.');
  const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'id' });
    if (!db.objectStoreNames.contains(CURRENT)) db.createObjectStore(CURRENT);
    if (!db.objectStoreNames.contains(UNREADABLE)) db.createObjectStore(UNREADABLE, { autoIncrement: true });
  };
  const db = await settled(request);
  // A later version opened in another tab asks this one to step aside.
  db.onversionchange = () => db.close();

  return {
    async current(kind) {
      const transaction = db.transaction([CURRENT, DRAFTS], 'readonly');
      const id = await settled(transaction.objectStore(CURRENT).get(kind));
      if (typeof id !== 'string') return null;
      const record: unknown = await settled(transaction.objectStore(DRAFTS).get(id));
      return isRecord(record) ? { id: record.id, text: record.text } : null;
    },

    async put(kind, draft) {
      const transaction = db.transaction([DRAFTS, CURRENT], 'readwrite');
      const record: DraftRecord = { ...draft, kind, savedAt: Date.now() };
      transaction.objectStore(DRAFTS).put(record);
      transaction.objectStore(CURRENT).put(draft.id, kind);
      await committed(transaction);
    },

    async setAside(kind, text, id) {
      const transaction = db.transaction([UNREADABLE, DRAFTS, CURRENT], 'readwrite');
      transaction.objectStore(UNREADABLE).add({ kind, text, at: Date.now() });
      if (id !== undefined) {
        transaction.objectStore(DRAFTS).delete(id);
        transaction.objectStore(CURRENT).delete(kind);
      }
      await committed(transaction);
    },

    close: () => db.close(),
  };
}

function isRecord(value: unknown): value is DraftRecord {
  if (typeof value !== 'object' || value === null) return false;
  const { id, text } = value as Partial<DraftRecord>;
  return typeof id === 'string' && typeof text === 'string';
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused the request.'));
  });
}

/** Resolves once the writes are on disk; a tab closing straight after keeps them. */
function committed(transaction: IDBTransaction): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB could not write the draft.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB stopped writing the draft.'));
  });
  transaction.commit?.();
  return done;
}

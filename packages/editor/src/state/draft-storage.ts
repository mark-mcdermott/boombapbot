import type { DocumentKind, ProjectBase, ProjectCodec } from '@boombapbot/contracts';

/** The part of Web Storage this module needs, so tests can supply a fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Holds a draft that failed validation, so nothing is silently discarded. */
export const UNREADABLE_DRAFT_KEY = 'boombapbot.draft.unreadable';

export type DraftLoad<Document extends ProjectBase> =
  | { status: 'empty' }
  | {
      status: 'restored';
      project: Document;
      /** What a draft from an earlier version lost on the way in. */
      changes: string[];
      /** The draft was another machine's, and this one took it over. */
      adopted: boolean;
    }
  | { status: 'unreadable'; errors: string[] }
  | { status: 'unavailable'; errors: string[] };

/**
 * Reads the saved draft, falling back to one left by an earlier version. An
 * invalid draft is set aside, not deleted; one from an earlier version stays
 * where it is.
 */
export function loadDraft<Document extends ProjectBase>(
  storage: KeyValueStorage,
  kind: DocumentKind<Document>,
  codec: ProjectCodec<Document>,
): DraftLoad<Document> {
  let key = kind.draftKey;
  let text: string | null = null;
  try {
    for (key of [kind.draftKey, ...kind.earlierDraftKeys]) {
      text = storage.getItem(key);
      if (text !== null) break;
    }
  } catch (error) {
    return { status: 'unavailable', errors: [describe(error)] };
  }
  if (text === null) return { status: 'empty' };

  const result = codec.parseText(text);
  if (result.ok) {
    return { status: 'restored', project: result.project, changes: result.changes, adopted: result.adopted === true };
  }

  // A draft kept where an earlier version left it is never moved or removed.
  if (key === kind.draftKey) {
    try {
      storage.setItem(UNREADABLE_DRAFT_KEY, text);
      storage.removeItem(key);
    } catch {
      // Keeping the unreadable copy is best effort.
    }
  }
  return { status: 'unreadable', errors: result.errors };
}

export type DraftSave = { ok: true } | { ok: false; error: string };

export function saveDraft<Document extends ProjectBase>(
  storage: KeyValueStorage,
  kind: DocumentKind<Document>,
  project: Document,
): DraftSave {
  try {
    storage.setItem(kind.draftKey, kind.serialize(project));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/** localStorage when it is usable, otherwise null (private mode, blocked). */
export function browserStorage(): KeyValueStorage | null {
  try {
    const storage = globalThis.localStorage;
    const probe = 'boombapbot.probe';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

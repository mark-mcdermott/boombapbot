import { parseProjectText, serializeProject, type Project } from '@boombapbot/contracts';

/** The part of Web Storage this module needs, so tests can supply a fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DRAFT_KEY = 'boombapbot.draft.v2';
/** Where earlier versions kept the draft. Read once, when there is no current draft. */
export const LEGACY_DRAFT_KEY = 'boombapbot.draft.v1';
/** Holds a draft that failed validation, so nothing is silently discarded. */
export const UNREADABLE_DRAFT_KEY = 'boombapbot.draft.unreadable';

export type DraftLoad =
  | { status: 'empty' }
  | {
      status: 'restored';
      project: Project;
      /** What a draft from an earlier version lost on the way in. */
      changes: string[];
    }
  | { status: 'unreadable'; errors: string[] }
  | { status: 'unavailable'; errors: string[] };

/**
 * Reads the saved draft, falling back to one left by an earlier version. An
 * invalid draft is set aside, not deleted.
 */
export function loadDraft(storage: KeyValueStorage): DraftLoad {
  let key = DRAFT_KEY;
  let text: string | null;
  try {
    text = storage.getItem(key);
    if (text === null) {
      key = LEGACY_DRAFT_KEY;
      text = storage.getItem(key);
    }
  } catch (error) {
    return { status: 'unavailable', errors: [describe(error)] };
  }
  if (text === null) return { status: 'empty' };

  const result = parseProjectText(text);
  if (result.ok) return { status: 'restored', project: result.project, changes: result.changes };

  try {
    storage.setItem(UNREADABLE_DRAFT_KEY, text);
    storage.removeItem(key);
  } catch {
    // Keeping the unreadable copy is best effort.
  }
  return { status: 'unreadable', errors: result.errors };
}

export type DraftSave = { ok: true } | { ok: false; error: string };

export function saveDraft(storage: KeyValueStorage, project: Project): DraftSave {
  try {
    storage.setItem(DRAFT_KEY, serializeProject(project));
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

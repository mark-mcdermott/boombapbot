import { parseProjectText, serializeProject, type Project } from '@boombapbot/contracts';

/** The part of Web Storage this module needs, so tests can supply a fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DRAFT_KEY = 'boombapbot.draft.v1';
/** Holds a draft that failed validation, so nothing is silently discarded. */
export const UNREADABLE_DRAFT_KEY = 'boombapbot.draft.unreadable';

export type DraftLoad =
  | { status: 'empty' }
  | { status: 'restored'; project: Project }
  | { status: 'unreadable'; errors: string[] }
  | { status: 'unavailable'; errors: string[] };

/** Reads the saved draft. An invalid draft is set aside, not deleted. */
export function loadDraft(storage: KeyValueStorage): DraftLoad {
  let text: string | null;
  try {
    text = storage.getItem(DRAFT_KEY);
  } catch (error) {
    return { status: 'unavailable', errors: [describe(error)] };
  }
  if (text === null) return { status: 'empty' };

  const result = parseProjectText(text);
  if (result.ok) return { status: 'restored', project: result.project };

  try {
    storage.setItem(UNREADABLE_DRAFT_KEY, text);
    storage.removeItem(DRAFT_KEY);
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

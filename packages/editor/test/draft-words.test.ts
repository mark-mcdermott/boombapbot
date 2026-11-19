import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorRuntime } from '../src/runtime';
import type { KeyValueStorage } from '../src/state/draft-storage';
import { closingNoteText, draftStatusText } from '../src/ui/draft-words';
import { testMachine } from './test-machine';

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

const runtimeWith = (storage?: KeyValueStorage | null) =>
  new EditorRuntime({ baseUrl: '/', machine: testMachine, storage });

describe('storage that is missing from the start', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is reported as soon as the editor opens, as a failed write is', () => {
    expect(runtimeWith(null).store.getState().draftState).toBe('error');
  });

  it('is reported when the browser will not hand over its storage', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    expect(runtimeWith().store.getState().draftState).toBe('error');
  });

  it('is not reported when a shell hands in its own store', () => {
    expect(runtimeWith(new MemoryStorage()).store.getState().draftState).toBe('saved');
  });
});

describe('the draft status line', () => {
  it('names the browser and an account on the site', () => {
    expect(draftStatusText({ state: 'saved', savedAt: null, accounts: true })).toBe(
      'Draft will be saved in this browser',
    );
    expect(draftStatusText({ state: 'error', savedAt: null, accounts: true })).toBe(
      'This browser is not saving drafts. To keep this beat, export the project file or save it to an account.',
    );
  });

  it('names the device and only the export in a shell', () => {
    expect(draftStatusText({ state: 'saved', savedAt: null, accounts: false })).toBe(
      'Draft will be saved on this device',
    );
    expect(draftStatusText({ state: 'saved', savedAt: Date.now(), accounts: false })).toMatch(
      /^Draft saved on this device at /,
    );
    expect(draftStatusText({ state: 'error', savedAt: null, accounts: false })).toBe(
      'This device is not saving drafts. Export the project to keep it.',
    );
  });
});

describe('the closing note', () => {
  it('points to the account button on the site', () => {
    const note = closingNoteText({ accounts: true, kept: true });
    expect(note).toContain('Your beat is saved in this browser as you go.');
    expect(note).toContain('save the beat to a free account from the account button in the footer');
  });

  it('has no account and no footer in a shell, and keeps the beat on the device', () => {
    const note = closingNoteText({ accounts: false, kept: true });
    expect(note).toContain('Your beat is saved on this device as you go.');
    expect(note).toContain('export the project file here.');
    expect(note).not.toMatch(/account|footer|browser/);
  });

  it('does not promise the draft is saved when it cannot be', () => {
    for (const accounts of [true, false]) {
      expect(closingNoteText({ accounts, kept: false })).not.toContain('saved');
    }
  });
});

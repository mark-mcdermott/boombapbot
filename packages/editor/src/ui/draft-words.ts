import type { DraftState } from '../state/store';

/**
 * What the settings sheet says about the draft. The site keeps it in the
 * browser and has accounts; a shell keeps it on the device and has none.
 */
export interface DraftWordsContext {
  /** Whether the page has an account to save a beat to. Only the site has one. */
  accounts: boolean;
}

export interface DraftStatus extends DraftWordsContext {
  state: DraftState;
  savedAt: number | null;
}

export function draftStatusText({ state, savedAt, accounts }: DraftStatus): string {
  if (state === 'error') {
    return accounts
      ? 'This browser is not saving drafts. To keep this beat, export the project file or save it to an account.'
      : 'This device is not saving drafts. Export the project to keep it.';
  }
  if (state === 'elsewhere') return draftElsewhereText({ accounts });
  const place = accounts ? 'in this browser' : 'on this device';
  return savedAt
    ? `Draft saved ${place} at ${new Date(savedAt).toLocaleTimeString()}`
    : `Draft will be saved ${place}`;
}

/** Said while another tab, or on a device another window, owns the draft. */
export function draftElsewhereText({ accounts }: DraftWordsContext): string {
  return `This beat is open in another ${accounts ? 'tab' : 'window'}, which is saving it. Changes here are not saved.`;
}

export interface ClosingNote extends DraftWordsContext {
  /** False when the draft cannot be written, so the note does not promise it. */
  kept: boolean;
}

export function closingNoteText({ accounts, kept }: ClosingNote): string {
  const sentences = ['v0.1 preview. The drum sounds are made from the knobs; none of them is a recording.'];
  if (kept) sentences.push(`Your beat is saved ${accounts ? 'in this browser' : 'on this device'} as you go.`);
  sentences.push(
    accounts
      ? 'To keep a copy or move to another device, export the project file here, or save the beat to a free account from the account button in the footer.'
      : 'To keep a copy or move to another device, export the project file here.',
  );
  return sentences.join(' ');
}

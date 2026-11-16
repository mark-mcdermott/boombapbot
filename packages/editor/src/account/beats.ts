import {
  BeatAnswerSchema,
  BeatListAnswerSchema,
  BeatRefusalSchema,
  BeatSavedAnswerSchema,
  type BeatListAnswer,
  type BeatRefusal,
  type BeatSummary,
  type Project,
} from '@boombapbot/contracts';
import { UNREACHABLE, type Failure } from './client';

// The saved beats of the account that is logged in. Every call here is
// started by a button in the account modal; the machine never waits on one.

export interface BeatFailure extends Failure {
  code?: BeatRefusal | typeof UNREACHABLE.code;
  /** With a conflict: when the cloud copy was saved. */
  updatedAt?: string;
}

export type Asked<Answer> = { ok: true; answer: Answer } | { ok: false; failure: BeatFailure };

/** Anything that can check an answer's shape, as the contracts' schemas do. */
interface Reader<Answer> {
  safeParse(value: unknown): { success: true; data: Answer } | { success: false };
}

async function ask<Answer>(url: string, reader: Reader<Answer>, method = 'GET', body?: unknown): Promise<Asked<Answer>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, failure: UNREACHABLE };
  }
  const said: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const answer = reader.safeParse(said);
    return answer.success ? { ok: true, answer: answer.data } : { ok: false, failure: { status: response.status } };
  }
  const refusal = BeatRefusalSchema.safeParse(said);
  return { ok: false, failure: { status: response.status, ...(refusal.success ? refusal.data : {}) } };
}

const address = (baseUrl: string, id?: string) => `${baseUrl}api/beats${id ? `/${encodeURIComponent(id)}` : ''}`;

export function listBeats(baseUrl: string): Promise<Asked<BeatListAnswer>> {
  return ask(address(baseUrl), BeatListAnswerSchema);
}

export function saveNewBeat(baseUrl: string, project: Project): Promise<Asked<{ beat: BeatSummary }>> {
  return ask(address(baseUrl), BeatSavedAnswerSchema, 'POST', { project });
}

/**
 * Replaces a saved beat. `lastSeen` is when the copy this device last loaded
 * or saved was saved; a newer cloud copy is answered with a conflict unless
 * `overwrite` says the person has been asked.
 */
export function replaceBeat(
  baseUrl: string,
  id: string,
  project: Project,
  lastSeen: string,
  overwrite: boolean,
): Promise<Asked<{ beat: BeatSummary }>> {
  return ask(address(baseUrl, id), BeatSavedAnswerSchema, 'PUT', { project, lastSeen, overwrite });
}

export function fetchBeat(baseUrl: string, id: string): Promise<Asked<{ beat: BeatSummary; project?: unknown }>> {
  return ask(address(baseUrl, id), BeatAnswerSchema);
}

export function deleteBeat(baseUrl: string, id: string): Promise<Asked<unknown>> {
  return ask(address(baseUrl, id), { safeParse: (value) => ({ success: true, data: value }) }, 'DELETE');
}

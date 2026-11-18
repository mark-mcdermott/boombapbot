import {
  BeatAnswerSchema,
  BeatListAnswerSchema,
  BeatRefusalSchema,
  BeatSavedAnswerSchema,
  type BeatListAnswer,
  type BeatRefusal,
  type BeatSummary,
  type ProjectBase,
} from '@boombapbot/contracts';
import { ANY_ANSWER, ask as askServer, type Asked as AskedOf, type Reader } from './ask';
import { UNREACHABLE, type Failure } from './client';

// The saved beats of the account that is logged in. Every call here is
// started by a button in the account modal; the machine never waits on one.

export interface BeatFailure extends Failure {
  code?: BeatRefusal | typeof UNREACHABLE.code;
  /** With a conflict: when the cloud copy was saved. */
  updatedAt?: string;
}

export type Asked<Answer> = AskedOf<Answer, BeatFailure>;

const ask = <Answer>(url: string, reader: Reader<Answer>, method?: string, body?: unknown): Promise<Asked<Answer>> =>
  askServer(url, reader, BeatRefusalSchema, method, body);

const address = (baseUrl: string, id?: string) => `${baseUrl}api/beats${id ? `/${encodeURIComponent(id)}` : ''}`;

export function listBeats(baseUrl: string): Promise<Asked<BeatListAnswer>> {
  return ask(address(baseUrl), BeatListAnswerSchema);
}

export function saveNewBeat(baseUrl: string, project: ProjectBase): Promise<Asked<{ beat: BeatSummary }>> {
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
  project: ProjectBase,
  lastSeen: string,
  overwrite: boolean,
): Promise<Asked<{ beat: BeatSummary }>> {
  return ask(address(baseUrl, id), BeatSavedAnswerSchema, 'PUT', { project, lastSeen, overwrite });
}

export function fetchBeat(baseUrl: string, id: string): Promise<Asked<{ beat: BeatSummary; project?: unknown }>> {
  return ask(address(baseUrl, id), BeatAnswerSchema);
}

export function deleteBeat(baseUrl: string, id: string): Promise<Asked<unknown>> {
  return ask(address(baseUrl, id), ANY_ANSWER, 'DELETE');
}

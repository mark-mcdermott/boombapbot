import { z } from 'zod';

// Beats saved to an account. The machine keeps its working copy in the
// browser; saving sends a copy of the project to the server, and loading
// brings one back. The page and the server both read the limits and the
// conflict rule from here, so they cannot disagree.

/** How many beats a free account holds. */
export const FREE_BEAT_LIMIT = 20;
/** The most one saved beat may weigh, as project JSON. */
export const MAX_BEAT_BYTES = 64 * 1024;

/** What a project weighs when saved: the bytes of its JSON, written compactly. */
/** The longest name a beat may have, as a project's own name. */
export const MAX_BEAT_NAME_LENGTH = 80;

export function beatBytes(project: unknown): number {
  return new TextEncoder().encode(JSON.stringify(project) ?? '').length;
}

export function beatTooLarge(bytes: number, maxBytes = MAX_BEAT_BYTES): boolean {
  return bytes > maxBytes;
}

/** Whether an account that holds this many beats has room for no more. */
export function beatLimitReached(count: number, limit = FREE_BEAT_LIMIT): boolean {
  return count >= limit;
}

/**
 * The conflict rule. A save replaces the cloud copy unless that copy was
 * saved after the one this device last loaded or saved; then somebody else,
 * or another device, got there first and the page has to ask.
 */
export function cloudCopyIsNewer(cloudUpdatedAt: Date | string, lastSeen: Date | string): boolean {
  return new Date(cloudUpdatedAt).getTime() > new Date(lastSeen).getTime();
}

export function formatKilobytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** A saved beat as the list shows it. Its `id` is the row's uuid. */
export const BeatSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  bytes: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type BeatSummary = z.infer<typeof BeatSummarySchema>;

/** What the server answers when asked for an account's beats, newest first. */
export const BeatListAnswerSchema = z.object({
  beats: z.array(BeatSummarySchema),
  /** How many this account may hold. */
  limit: z.number().int().positive(),
});
export type BeatListAnswer = z.infer<typeof BeatListAnswerSchema>;

/** The answer to a save, new or replacing. */
export const BeatSavedAnswerSchema = z.object({ beat: BeatSummarySchema });

/** One beat with its project, which the page validates again before using it. */
export const BeatAnswerSchema = z.object({ beat: BeatSummarySchema, project: z.unknown() });

/** The project is checked with `parseProject`, after it has been weighed. */
export const SaveBeatRequestSchema = z.object({ project: z.unknown() });

export const ReplaceBeatRequestSchema = SaveBeatRequestSchema.extend({
  /** When the copy this device last loaded or saved was saved. */
  lastSeen: z.iso.datetime(),
  /** Set once the person has been asked and chose to replace a newer cloud copy. */
  overwrite: z.boolean().default(false),
});

/** A new name for a saved beat. Nothing else about the beat changes. */
export const RenameBeatRequestSchema = z.object({
  name: z.string().trim().min(1).max(MAX_BEAT_NAME_LENGTH),
});

/** Why the server refused, for the page to act on. The message is for the person. */
export const BEAT_REFUSALS = ['signed_out', 'invalid', 'too_large', 'limit', 'conflict', 'not_found'] as const;
export type BeatRefusal = (typeof BEAT_REFUSALS)[number];

export const BeatRefusalSchema = z.object({
  code: z.enum(BEAT_REFUSALS),
  message: z.string(),
  /** With `conflict`: when the cloud copy was saved. */
  updatedAt: z.iso.datetime().optional(),
});

import { describe, expect, it } from 'vitest';
import {
  BeatRefusalSchema,
  FREE_BEAT_LIMIT,
  MAX_BEAT_BYTES,
  MAX_BEAT_NAME_LENGTH,
  RenameBeatRequestSchema,
  ReplaceBeatRequestSchema,
  beatBytes,
  beatLimitReached,
  beatTooLarge,
  cloudCopyIsNewer,
  formatKilobytes,
} from '../src/beats';

describe('the limits on saved beats', () => {
  it('a free account holds twenty beats of 64 KB each', () => {
    expect(FREE_BEAT_LIMIT).toBe(20);
    expect(MAX_BEAT_BYTES).toBe(65_536);
  });

  it('the account is full at the limit, not before it', () => {
    expect(beatLimitReached(0)).toBe(false);
    expect(beatLimitReached(FREE_BEAT_LIMIT - 1)).toBe(false);
    expect(beatLimitReached(FREE_BEAT_LIMIT)).toBe(true);
    expect(beatLimitReached(FREE_BEAT_LIMIT + 1)).toBe(true);
    // A raised limit, as a paid account would have.
    expect(beatLimitReached(FREE_BEAT_LIMIT, 100)).toBe(false);
  });

  it('a beat weighs the bytes of its JSON, not its characters', () => {
    expect(beatBytes({ name: 'kick' })).toBe('{"name":"kick"}'.length);
    expect(beatBytes({ name: '🥁' })).toBe('{"name":""}'.length + 4);
    expect(beatBytes(undefined)).toBe(0);
  });

  it('a beat is too large only past the limit', () => {
    expect(beatTooLarge(MAX_BEAT_BYTES)).toBe(false);
    expect(beatTooLarge(MAX_BEAT_BYTES + 1)).toBe(true);
    expect(beatTooLarge(100, 50)).toBe(true);
  });

  it('sizes are shown in whole kilobytes, never as nothing', () => {
    expect(formatKilobytes(MAX_BEAT_BYTES)).toBe('64 KB');
    expect(formatKilobytes(22_900)).toBe('22 KB');
    expect(formatKilobytes(12)).toBe('1 KB');
  });
});

describe('the conflict rule', () => {
  const seen = '2026-11-16T12:00:00.000Z';

  it('a cloud copy saved after the one this device last had is newer', () => {
    expect(cloudCopyIsNewer('2026-11-16T12:00:00.001Z', seen)).toBe(true);
    expect(cloudCopyIsNewer(new Date('2026-11-17T00:00:00Z'), seen)).toBe(true);
  });

  it('the copy this device last had, or an older one, is not', () => {
    expect(cloudCopyIsNewer(seen, seen)).toBe(false);
    expect(cloudCopyIsNewer(new Date(seen), new Date(seen))).toBe(false);
    expect(cloudCopyIsNewer('2026-11-16T11:59:59.999Z', seen)).toBe(false);
  });

  it('the same moment written in another time zone is the same moment', () => {
    expect(cloudCopyIsNewer('2026-11-16T13:00:00.000+01:00', seen)).toBe(false);
  });

  it('a replace says when its copy was last seen, and overwrites only when told to', () => {
    const asked = ReplaceBeatRequestSchema.parse({ project: {}, lastSeen: seen });
    expect(asked.overwrite).toBe(false);
    expect(ReplaceBeatRequestSchema.parse({ project: {}, lastSeen: seen, overwrite: true }).overwrite).toBe(true);
    expect(ReplaceBeatRequestSchema.safeParse({ project: {} }).success).toBe(false);
    expect(ReplaceBeatRequestSchema.safeParse({ project: {}, lastSeen: 'yesterday' }).success).toBe(false);
  });

  it('a conflict answer carries the time of the cloud copy', () => {
    const refusal = BeatRefusalSchema.parse({ code: 'conflict', message: 'Newer.', updatedAt: seen });
    expect(refusal.updatedAt).toBe(seen);
    expect(BeatRefusalSchema.safeParse({ code: 'unheard-of', message: '' }).success).toBe(false);
  });
});

describe('a new name for a saved beat', () => {
  it('is trimmed, and is as long as a project’s name may be', () => {
    expect(RenameBeatRequestSchema.parse({ name: '  Night shift  ' })).toEqual({ name: 'Night shift' });
    expect(RenameBeatRequestSchema.safeParse({ name: 'x'.repeat(MAX_BEAT_NAME_LENGTH) }).success).toBe(true);
  });

  it('is refused when it is empty, only spaces, too long or not text', () => {
    for (const name of ['', '   ', 'x'.repeat(MAX_BEAT_NAME_LENGTH + 1), 7, undefined]) {
      expect(RenameBeatRequestSchema.safeParse({ name }).success).toBe(false);
    }
  });
});

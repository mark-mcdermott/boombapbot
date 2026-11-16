import { describe, expect, it } from 'vitest';
import { withPublicIds } from '../src/server/public-ids';

describe('withPublicIds', () => {
  it('names a record by its uuid and drops every row id', () => {
    const created = new Date('2026-11-15T00:00:00Z');
    const answer = {
      session: { id: '7', uuid: 'session-uuid', userId: '3', token: 'abc', createdAt: created },
      user: { id: '3', uuid: 'user-uuid', email: 'a@example.com' },
    };
    expect(withPublicIds(answer)).toEqual({
      session: { id: 'session-uuid', token: 'abc', createdAt: created },
      user: { id: 'user-uuid', email: 'a@example.com' },
    });
  });

  it('drops an id that has no uuid to stand in for it, in lists too', () => {
    expect(withPublicIds([{ id: '4', accountId: '3', providerId: 'credential' }])).toEqual([
      { providerId: 'credential' },
    ]);
  });

  it('hands back the same value when there is nothing to hide', () => {
    const answer = { status: true, items: [{ message: 'ok' }], when: new Date() };
    expect(withPublicIds(answer)).toBe(answer);
    expect(withPublicIds(null)).toBeNull();
    expect(withPublicIds('3')).toBe('3');
  });
});

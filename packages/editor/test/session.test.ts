import { describe, expect, it } from 'vitest';
import { signedInAccount } from '../src/account/session';

// What /api/auth/get-session can answer with a 200, and who the page takes
// to be logged in. A host with no server behind it answered with its own
// page, and the account modal threw on it.

describe('who is logged in', () => {
  it('is the user a session names', () => {
    const answer = {
      session: { token: 'not-read' },
      user: { id: '0f8b6c1e-5a55-4d0b-9d0a-3f1f1f0b7c11', email: 'someone@example.com', name: '', emailVerified: true },
    };
    expect(signedInAccount(answer)).toEqual({
      id: '0f8b6c1e-5a55-4d0b-9d0a-3f1f1f0b7c11',
      email: 'someone@example.com',
      image: null,
    });
  });

  it('has the picture the site serves for it', () => {
    const image = '/api/avatars/9b2f6a0c-3d41-4e7a-8a55-0c1d2e3f4a5b';
    const user = { id: 'an-id', email: 'someone@example.com', image };
    expect(signedInAccount({ user })?.image).toBe(image);
  });

  it.each([
    ['another site', 'https://example.com/a.png'],
    ['an address with no scheme', '//example.com/a.png'],
    ['a script', 'javascript:alert(1)'],
    ['another path of this site', '/api/avatars/../auth/sign-out'],
    ['a picture with something after its id', '/api/avatars/9b2f6a0c-3d41-4e7a-8a55-0c1d2e3f4a5b?x=1'],
    ['a number', 7],
  ])('has no picture when its image is %s', (_, image) => {
    expect(signedInAccount({ user: { id: 'an-id', email: 'someone@example.com', image } })).toEqual({
      id: 'an-id',
      email: 'someone@example.com',
      image: null,
    });
  });

  it.each([
    ['null, which is what the server says when nobody is', null],
    ['nothing at all', undefined],
    ['an empty object', {}],
    ['a session with no user', { session: { token: 'not-read' } }],
    ['a user that is null', { session: null, user: null }],
    ['a user with no address', { user: { id: 'an-id' } }],
    ['a user whose id is a number', { user: { id: 7, email: 'someone@example.com' } }],
    ['the page of a host with no server', '<!doctype html><html><body>Not the API</body></html>'],
    ['a list', []],
  ])('is nobody for %s', (_, answer) => {
    expect(signedInAccount(answer)).toBeNull();
  });
});

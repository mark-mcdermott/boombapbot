import { describe, expect, it } from 'vitest';
import { avatarTypeOf, isAvatarPath } from '../src/avatar';

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((value) => (typeof value === 'string' ? [...value].map((c) => c.charCodeAt(0)) : [value])));

describe('what kind of picture some bytes are', () => {
  it('knows a JPEG, a PNG and a WebP by how they start', () => {
    expect(avatarTypeOf(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe('image/jpeg');
    expect(avatarTypeOf(bytes(0x89, 'PNG\r\n', 0x1a, 0x0a, 0, 0))).toBe('image/png');
    expect(avatarTypeOf(bytes('RIFF', 1, 2, 3, 4, 'WEBPVP8 '))).toBe('image/webp');
  });

  it.each([
    ['nothing', bytes()],
    ['a drawing a browser would run scripts from', bytes('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')],
    ['a page', bytes('<!doctype html><html></html>')],
    ['a GIF', bytes('GIF89a', 0, 0)],
    ['a sound in the same wrapper as a WebP', bytes('RIFF', 1, 2, 3, 4, 'WAVEfmt ')],
    ['a PNG cut off in its signature', bytes(0x89, 'PN')],
  ])('keeps none of %s', (_, sent) => {
    expect(avatarTypeOf(sent)).toBeNull();
  });
});

describe('where a picture is served', () => {
  it('is this site’s own address for one, and nothing else', () => {
    expect(isAvatarPath('/api/avatars/9b2f6a0c-3d41-4e7a-8a55-0c1d2e3f4a5b')).toBe(true);
    expect(isAvatarPath('https://example.com/api/avatars/9b2f6a0c-3d41-4e7a-8a55-0c1d2e3f4a5b')).toBe(false);
    expect(isAvatarPath('/api/avatars/not-an-id')).toBe(false);
    expect(isAvatarPath(null)).toBe(false);
  });
});

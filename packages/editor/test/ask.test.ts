import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANY_ANSWER, ask, type Reader } from '../src/account/ask';
import { deleteBeat, listBeats } from '../src/account/beats';

// What a request to the site's server carries. The site refuses a request
// from another origin that changes something and names no type, which is
// what an app's page sends from: these hold every such request to a type.

const SITE = 'https://site.example/';
/** A refusal nothing is read from. */
const NOTHING_SAID: Reader<object> = { safeParse: () => ({ success: false }) };

function answering(status = 200, said: unknown = {}) {
  const sent: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response(JSON.stringify(said), { status });
  });
  return sent;
}

const typeSent = (init: RequestInit) => new Headers(init.headers).get('content-type');

afterEach(() => vi.unstubAllGlobals());

describe('a request to the site’s server', () => {
  it('names a type when it deletes, though it has no body', async () => {
    const sent = answering();
    expect(await deleteBeat(SITE, 'a-beat')).toEqual({ ok: true, answer: {} });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(`${SITE}api/beats/a-beat`);
    expect(sent[0]!.init.method).toBe('DELETE');
    expect(sent[0]!.init.body).toBeUndefined();
    expect(typeSent(sent[0]!.init)).toBe('application/json');
  });

  it('names none when it only reads', async () => {
    const sent = answering(200, { beats: [], limit: 20 });
    await listBeats(SITE);
    expect(sent[0]!.init.method).toBe('GET');
    expect(typeSent(sent[0]!.init)).toBeNull();
  });

  it('sends a body as JSON and a file under its own type', async () => {
    const sent = answering();
    await ask(`${SITE}api/thing`, ANY_ANSWER, NOTHING_SAID, 'POST', { one: 1 });
    await ask(`${SITE}api/thing`, ANY_ANSWER, NOTHING_SAID, 'PUT', new Blob(['x'], { type: 'image/webp' }));
    expect(typeSent(sent[0]!.init)).toBe('application/json');
    expect(sent[0]!.init.body).toBe('{"one":1}');
    expect(typeSent(sent[1]!.init)).toBe('image/webp');
    expect(sent[1]!.init.body).toBeInstanceOf(Blob);
  });

  it('is no answer at all when nothing comes back', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await deleteBeat(SITE, 'a-beat')).toEqual({ ok: false, failure: { code: 'UNREACHABLE' } });
  });
});

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { printfulClient } from '../../../scripts/printful-api.mjs';
import {
  isRegistered,
  run,
  siteTakesSecret,
  wantedEvents,
  webhookUrl,
  withoutQuery,
} from '../../../scripts/register-printful-webhook.mjs';

interface Call {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

let server: Server | undefined;

/** A stand-in that records what it is asked and answers as told. */
async function standIn(answer: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString();
    const call: Call = {
      method: request.method ?? '',
      path: request.url ?? '',
      headers: request.headers,
      body: text ? JSON.parse(text) : undefined,
    };
    calls.push(call);
    const { status, body } = answer(call);
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return { address: `http://127.0.0.1:${port}`, calls };
}

afterEach(async () => {
  await new Promise((done) => (server ? server.close(done) : done(undefined)));
  server = undefined;
});

describe('the address Printful is given', () => {
  it('is the site’s webhook, carrying the secret', () => {
    expect(webhookUrl('https://boombapbot.com', 'abc123')).toBe(
      'https://boombapbot.com/api/webhooks/printful?secret=abc123',
    );
  });

  it('is printed without what it carries', () => {
    const printed = withoutQuery(webhookUrl('https://boombapbot.com', 'abc123'));
    expect(printed).toBe('https://boombapbot.com/api/webhooks/printful (with a secret, not shown)');
    expect(printed).not.toContain('abc123');
    expect(withoutQuery('https://example.com/hook')).toBe('https://example.com/hook');
    expect(withoutQuery(null)).toBe('nowhere');
  });

  it('asks for the events the site’s webhook acts on', () => {
    expect(wantedEvents()).toEqual(['order_canceled', 'order_failed', 'package_shipped']);
  });
});

describe('isRegistered', () => {
  const wanted = { url: 'https://boombapbot.com/api/webhooks/printful?secret=abc123', types: ['a', 'b'] };

  it('is true for the same address and the same events in any order', () => {
    expect(isRegistered({ url: wanted.url, types: ['b', 'a'], params: [] }, wanted)).toBe(true);
  });

  it('is false for another address, another secret, other events, or nothing', () => {
    expect(isRegistered({ url: 'https://example.com/hook', types: ['a', 'b'] }, wanted)).toBe(false);
    expect(isRegistered({ url: wanted.url.replace('abc123', 'old'), types: ['a', 'b'] }, wanted)).toBe(false);
    expect(isRegistered({ url: wanted.url, types: ['a'] }, wanted)).toBe(false);
    expect(isRegistered({ url: wanted.url, types: ['a', 'b', 'c'] }, wanted)).toBe(false);
    expect(isRegistered({ url: null, types: [] }, wanted)).toBe(false);
    expect(isRegistered(undefined, wanted)).toBe(false);
  });
});

describe('printfulClient', () => {
  it('refuses to start without a token', () => {
    expect(() => printfulClient({ token: undefined })).toThrow('PRINTFUL_API_KEY is not set');
  });

  it('reads with the token and the store, and posts a body as JSON', async () => {
    const registered = { url: 'https://example.com/hook', types: ['package_shipped'] };
    const { address, calls } = await standIn(() => ({ status: 200, body: { code: 200, result: registered } }));
    const printful = printfulClient({ token: 'token', storeId: '42', api: address });

    expect(await printful('/webhooks')).toEqual(registered);
    expect(await printful('/webhooks', registered)).toEqual(registered);

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /webhooks', 'POST /webhooks']);
    expect(calls[0]?.headers.authorization).toBe('Bearer token');
    expect(calls[0]?.headers['x-pf-store-id']).toBe('42');
    expect(calls[1]?.headers['content-type']).toBe('application/json');
    expect(calls[1]?.body).toEqual(registered);
  });

  it('throws Printful’s reason when it refuses', async () => {
    const { address } = await standIn(() => ({
      status: 403,
      body: { code: 403, error: { message: 'This token lacks the webhooks scope.' } },
    }));
    const printful = printfulClient({ token: 'token', api: address });
    await expect(printful('/webhooks')).rejects.toThrow(
      'Printful answered 403 for /webhooks: This token lacks the webhooks scope.',
    );
  });
});

describe('siteTakesSecret', () => {
  it('is true when the site answers, and sends an event the site ignores', async () => {
    const { address, calls } = await standIn(() => ({ status: 200, body: { received: true } }));
    expect(await siteTakesSecret(webhookUrl(address, 'abc123'))).toBe(true);
    expect(calls[0]?.path).toBe('/api/webhooks/printful?secret=abc123');
    expect(calls[0]?.body).toEqual({ type: 'boombapbot_secret_check', data: {} });
  });

  it('is false when the site refuses the secret', async () => {
    const { address } = await standIn(() => ({ status: 403, body: { message: 'Not allowed.' } }));
    expect(await siteTakesSecret(webhookUrl(address, 'abc123'))).toBe(false);
  });

  it('throws, without the secret, when the site is not answering as a site should', async () => {
    const { address } = await standIn(() => ({ status: 500, body: {} }));
    const failure = siteTakesSecret(webhookUrl(address, 'abc123'));
    await expect(failure).rejects.toThrow('answered 500');
    await expect(failure).rejects.not.toThrow('abc123');
  });
});

describe('run', () => {
  const EVENTS = ['order_canceled', 'order_failed', 'package_shipped'];

  /** One stand-in that is Printful and the site at once, holding one webhook. */
  async function world({ siteSecret = 'abc123', held = { url: null as string | null, types: [] as string[] } } = {}) {
    let webhook = held;
    const { address, calls } = await standIn((call) => {
      if (call.path.startsWith('/api/webhooks/printful')) {
        const given = new URL(call.path, 'http://localhost').searchParams.get('secret');
        return given === siteSecret
          ? { status: 200, body: { received: true } }
          : { status: 403, body: { message: 'Not allowed.' } };
      }
      if (call.method === 'POST') webhook = call.body as typeof held;
      return { status: 200, body: { code: 200, result: { ...webhook, params: [] } } };
    });
    const lines: string[] = [];
    const options = { token: 'token', secret: 'abc123', site: address, api: address, log: (line: string) => lines.push(line) };
    return { address, calls, lines, options, webhook: () => webhook };
  }

  it('only looks unless told to register', async () => {
    const { calls, lines, options, webhook } = await world();
    expect(await run({ ...options, register: false })).toBe('shown');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /webhooks']);
    expect(webhook().url).toBeNull();
    expect(lines[0]).toBe('Printful sends to nowhere, for no events');
    expect(lines.join('\n')).not.toContain('abc123');
  });

  it('registers the site’s address and events once the site takes the secret', async () => {
    const { address, lines, options, webhook } = await world();
    expect(await run({ ...options, register: true })).toBe('registered');
    expect(webhook()).toEqual({ url: `${address}/api/webhooks/printful?secret=abc123`, types: EVENTS });
    expect(lines.at(-1)).toBe(
      `Printful now sends to ${address}/api/webhooks/printful (with a secret, not shown), for ${EVENTS.join(', ')}`,
    );
    expect(lines.join('\n')).not.toContain('abc123');
  });

  it('changes nothing when Printful already has it', async () => {
    const { calls, options } = await world();
    await run({ ...options, register: true });
    calls.length = 0;
    expect(await run({ ...options, register: true })).toBe('kept');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /webhooks']);
  });

  it('registers nothing when the site was deployed with another secret', async () => {
    const { calls, options, webhook } = await world({ siteSecret: 'the-one-in-vercel' });
    const failure = run({ ...options, register: true });
    await expect(failure).rejects.toThrow('refused PRINTFUL_WEBHOOK_SECRET');
    await expect(failure).rejects.not.toThrow('abc123');
    expect(calls.some((call) => call.method === 'POST' && call.path === '/webhooks')).toBe(false);
    expect(webhook().url).toBeNull();
  });

  it('replaces an address that carries an old secret', async () => {
    const { address, options, webhook } = await world({
      held: { url: 'https://boombapbot.com/api/webhooks/printful?secret=old', types: EVENTS },
    });
    expect(await run({ ...options, register: true })).toBe('registered');
    expect(webhook().url).toBe(`${address}/api/webhooks/printful?secret=abc123`);
  });

  it('refuses to start without the secret', async () => {
    await expect(run({ token: 'token', secret: undefined, register: false })).rejects.toThrow(
      'PRINTFUL_WEBHOOK_SECRET is not set',
    );
  });
});

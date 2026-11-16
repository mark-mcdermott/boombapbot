#!/usr/bin/env node
// Tells Printful where to send news of an order: shipped, failed or canceled.
// Printful has no page for this; its API is the only way.
//
//   pnpm shop:webhook              shows what Printful has now and changes nothing
//   pnpm shop:webhook --register   points Printful at the live site
//
// Needs PRINTFUL_API_KEY and PRINTFUL_WEBHOOK_SECRET in apps/site/.env (and
// PRINTFUL_STORE_ID if the token can reach more than one store). The secret
// has to be the one the live site was deployed with; --register asks the site
// first and stops if it is not. The secret is never printed.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSiteEnv, printfulClient } from './printful-api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eventsPath = join(root, 'apps/site/src/server/shop/printful-events.json');
const SITE = 'https://boombapbot.com';

/** The events the site acts on, from the list its own webhook reads. */
export function wantedEvents() {
  return Object.keys(JSON.parse(readFileSync(eventsPath, 'utf8'))).sort();
}

/** The address Printful is given. It carries the secret, because Printful signs nothing. */
export function webhookUrl(site, secret) {
  const url = new URL('/api/webhooks/printful', site);
  url.searchParams.set('secret', secret);
  return url.href;
}

/** An address fit to print: where it points, without whatever it carries. */
export function withoutQuery(address) {
  if (!address) return 'nowhere';
  const url = new URL(address);
  return `${url.origin}${url.pathname}${url.search ? ' (with a secret, not shown)' : ''}`;
}

/** Whether Printful already sends exactly these events to exactly this address. */
export function isRegistered(current, wanted) {
  const types = [...(current?.types ?? [])].sort();
  return (
    current?.url === wanted.url &&
    types.length === wanted.types.length &&
    types.every((type, index) => type === wanted.types[index])
  );
}

/**
 * Whether the site at this address takes the secret. It is sent an event the
 * site has no use for, which a site with the same secret answers and ignores.
 */
export async function siteTakesSecret(url) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'boombapbot_secret_check', data: {} }),
  });
  if (response.ok) return true;
  if (response.status === 403) return false;
  throw new Error(`${withoutQuery(url)} answered ${response.status}; is the site up?`);
}

function described(label, webhook) {
  const types = [...(webhook?.types ?? [])].sort();
  return `${label} ${withoutQuery(webhook?.url)}, for ${types.length > 0 ? types.join(', ') : 'no events'}`;
}

/**
 * Shows what Printful has and, with `register`, sets what the site needs.
 * Answers 'kept' when Printful already had it, 'shown' when it was only
 * looked at, and 'registered' when it was set.
 */
export async function run({ token, storeId, secret, register, site = SITE, api, log = console.log }) {
  if (!secret) throw new Error('PRINTFUL_WEBHOOK_SECRET is not set in apps/site/.env');
  const printful = printfulClient({ token, storeId, api });
  const wanted = { url: webhookUrl(site, secret), types: wantedEvents() };

  try {
    const current = await printful('/webhooks');
    log(described('Printful sends to', current));
    if (isRegistered(current, wanted)) {
      log('That is what the site needs. Nothing to do.');
      return 'kept';
    }
    if (!register) {
      log(described('The site needs', wanted));
      log('Nothing was changed. Run `pnpm shop:webhook --register` to set it.');
      return 'shown';
    }
    if (!(await siteTakesSecret(wanted.url))) {
      throw new Error(`${site} refused PRINTFUL_WEBHOOK_SECRET. Set the same value in Vercel, deploy, and run this again.`);
    }
    log(described('Printful now sends to', await printful('/webhooks', wanted)));
    return 'registered';
  } catch (error) {
    throw new Error(error.message.replaceAll(secret, 'hidden'), { cause: error });
  }
}

async function main() {
  loadSiteEnv();
  await run({
    token: process.env.PRINTFUL_API_KEY,
    storeId: process.env.PRINTFUL_STORE_ID,
    secret: process.env.PRINTFUL_WEBHOOK_SECRET,
    register: process.argv.includes('--register'),
    log: (line) => console.log(`shop:webhook: ${line}`),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`shop:webhook: ${error.message}`);
    process.exit(1);
  });
}

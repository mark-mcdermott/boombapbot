// How the scripts talk to Printful, as the store named in apps/site/.env.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.printful.com';

/** Reads apps/site/.env into the process, if there is one. */
export function loadSiteEnv() {
  const envFile = join(root, 'apps/site/.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

/**
 * A function that asks Printful one thing and returns its `result`. With a
 * body it posts; without one it reads. A refusal is thrown with Printful's
 * reason.
 */
export function printfulClient({ token, storeId, api = API }) {
  if (!token) throw new Error('PRINTFUL_API_KEY is not set in apps/site/.env');
  const headers = { authorization: `Bearer ${token}` };
  if (storeId) headers['x-pf-store-id'] = storeId;

  return async function ask(path, body) {
    const request =
      body === undefined
        ? { headers }
        : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) };
    const response = await fetch(`${api}${path}`, request);
    const answer = await response.json();
    if (!response.ok) {
      throw new Error(`Printful answered ${response.status} for ${path}: ${answer.error?.message ?? 'no reason given'}`);
    }
    return answer.result;
  };
}

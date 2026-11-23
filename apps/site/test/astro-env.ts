// What `astro:env/server` is to the unit tests, which run outside Astro: a
// database in memory, and a signing key each test sets for itself.
export const DATABASE_URL = 'pglite:memory';
export let LICENSE_SIGNING_KEY: string | undefined;

export function setLicenseSigningKey(key: string | undefined): void {
  LICENSE_SIGNING_KEY = key;
}

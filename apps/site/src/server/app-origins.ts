import { APP_ORIGINS } from 'astro:env/server';

/** Where the phone apps' pages are served from inside the app: Capacitor's own addresses on iOS and Android. */
const PHONE_APPS = ['capacitor://localhost', 'https://localhost'];

/**
 * The origins other than the site's own that may call its API: the phone
 * apps, and any named in APP_ORIGINS, which the browser tests use to stand
 * in for one. They are never sent the site's cookie; they log in with a
 * token they carry themselves.
 */
export function appOrigins(): string[] {
  const named = (APP_ORIGINS ?? '').split(',').map((origin) => origin.trim());
  return [...PHONE_APPS, ...named.filter(Boolean)];
}

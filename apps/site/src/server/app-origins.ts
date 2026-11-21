import { APP_ORIGINS } from 'astro:env/server';

/** Where the phone apps' pages are served from inside the app: Capacitor's own addresses on iOS and Android. */
const PHONE_APPS = ['capacitor://localhost', 'https://localhost'];
/** And the desktop app's, inside its window: Tauri's own addresses on macOS and on Windows. */
const DESKTOP_APPS = ['tauri://localhost', 'http://tauri.localhost'];

/**
 * The origins other than the site's own that may call its API: the phone
 * and desktop apps, and any named in APP_ORIGINS, which the browser tests use to stand
 * in for one. They are never sent the site's cookie; they log in with a
 * token they carry themselves.
 */
export function appOrigins(): string[] {
  const named = (APP_ORIGINS ?? '').split(',').map((origin) => origin.trim());
  return [...PHONE_APPS, ...DESKTOP_APPS, ...named.filter(Boolean)];
}

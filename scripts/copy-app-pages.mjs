#!/usr/bin/env node
// Copies the site's pages of words into an app's public folder, so the app
// shows the words the site does with no server to fetch them from. The words
// are lifted from the built site, which is their one source.
//
//   pnpm build                                      at the repository root, first
//   node scripts/copy-app-assets.mjs apps/mobile    empties the app's public folder, so it goes before
//   node scripts/copy-app-pages.mjs apps/mobile     or the app's own `assets` script

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGES_FILE = 'boombapbot-pages.json';
const SLOT_OPEN = '<astro-slot>';
const SLOT_CLOSE = '</astro-slot>';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const built = join(root, 'apps/site/dist/client');

function fail(message) {
  console.error(`copy-app-pages: ${message}`);
  process.exit(1);
}

if (!process.argv[2]) fail('name the app to copy into, as in "node scripts/copy-app-pages.mjs apps/mobile".');
const app = resolve(process.argv[2]);
if (!existsSync(join(app, 'package.json'))) fail(`${app} is not an app of this repository.`);
const target = join(app, 'public');
if (!existsSync(target)) fail(`${relative(root, target)} is missing.\n  Run scripts/copy-app-assets.mjs for this app first.`);
if (!existsSync(built)) fail('apps/site/dist/client is missing.\n  Run pnpm build at the repository root.');

/** A page of words as the site built it, or null for any other page. */
function readPage(id) {
  const file = join(built, id, 'index.html');
  if (!existsSync(file)) return null;
  const html = readFileSync(file, 'utf8');
  const layout = /data-testid="site-page"[^>]*data-layout="(\w+)"|data-layout="(\w+)"[^>]*data-testid="site-page"/.exec(html);
  if (!layout) return null;
  const start = html.indexOf(SLOT_OPEN);
  const end = html.lastIndexOf(SLOT_CLOSE);
  if (start < 0 || end < start) fail(`${relative(root, file)} has no words where the page keeps them.`);
  return { layout: layout[1] ?? layout[2], html: html.slice(start + SLOT_OPEN.length, end) };
}

/** The site's own files a page shows, by the path the site serves them at. */
function filesShown(html) {
  const found = new Set();
  for (const [, value] of html.matchAll(/\s(?:src|srcset)="([^"]+)"/g)) {
    for (const candidate of value.split(',')) {
      const path = candidate.trim().split(/\s+/)[0];
      if (path?.startsWith('/')) found.add(path);
    }
  }
  return [...found];
}

/** In the app a page is a place in the one document, so a link to another page of the site goes by its hash. */
const linkWithinApp = (html) => html.replace(/\shref="\/([^"/]*)"/g, ' href="#/$1"');

const pages = {};
const copied = new Set();
for (const entry of readdirSync(built, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const page = readPage(entry.name);
  if (!page) continue;
  for (const path of filesShown(page.html)) {
    const from = join(built, path);
    if (!existsSync(from)) fail(`the ${entry.name} page shows ${path}, which the built site does not have.`);
    mkdirSync(dirname(join(target, path)), { recursive: true });
    cpSync(from, join(target, path));
    copied.add(path);
  }
  pages[entry.name] = { layout: page.layout, html: linkWithinApp(page.html) };
}

const ids = Object.keys(pages);
if (ids.length === 0) fail('the built site has no pages of words.\n  Run pnpm build at the repository root.');
writeFileSync(join(target, PAGES_FILE), JSON.stringify(pages));

console.log(`copy-app-pages: ${ids.join(', ')} and ${copied.size} picture(s) copied to ${relative(root, target)}`);

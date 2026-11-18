#!/usr/bin/env node
// Copies the engine, the worklet and the machine's panel art into this app
// from where scripts/prepare-assets.mjs put them for the site, so the app
// ships the same files the site serves.
//
//   pnpm prepare:assets                      at the repository root, first
//   node apps/mobile/scripts/copy-assets.mjs

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MACHINE = 'ritm12';
const MANIFEST = 'boombapbot-assets.json';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prepared = resolve(app, '../site/public');
const target = join(app, 'public');

function fail(message) {
  console.error(`copy-assets: ${message}`);
  process.exit(1);
}

const manifestPath = join(prepared, MANIFEST);
if (!existsSync(manifestPath)) {
  fail(`apps/site/public/${MANIFEST} is missing.\n  Run pnpm build:wasm, then pnpm prepare:assets, at the repository root.`);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.machine !== MACHINE) {
  fail(`the prepared assets are for "${manifest.machine}", and this app is ${MACHINE}.\n  Run pnpm prepare:assets with BOOMBAPBOT_MACHINE unset.`);
}
if (!manifest.art) fail('the asset manifest names no panel art.');

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(manifestPath, join(target, MANIFEST));
for (const file of [manifest.engine.wasm, manifest.engine.worklet]) {
  mkdirSync(dirname(join(target, file)), { recursive: true });
  cpSync(join(prepared, file), join(target, file));
}
cpSync(join(prepared, manifest.art), join(target, manifest.art), { recursive: true });

console.log(`copy-assets: ${MACHINE} engine, worklet and panel art copied to apps/mobile/public`);

#!/usr/bin/env node
// Puts РИТМ-12's panel art in the page's public folder and writes the manifest
// the editor finds it by. The site's own script (scripts/prepare-assets.mjs)
// also packs the engine built to WebAssembly; the plugin has the engine
// itself, so its page is built without one and needs no Emscripten.

import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MACHINE = 'ritm12';
const IMAGE = /\.(webp|png|svg|jpe?g)$/;

const here = dirname(fileURLToPath(import.meta.url));
const art = resolve(here, `../../../packages/machine-${MACHINE}/art`);
const target = join(here, 'public');
const served = `machines/${MACHINE}/`;

if (!existsSync(art)) {
  console.error(`assets: ${art} is missing.`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(art, join(target, served), {
  recursive: true,
  filter: (source) => statSync(source).isDirectory() || IMAGE.test(source),
});
const manifest = { machine: MACHINE, engine: { worklet: '', wasm: '' }, faceplate: null, art: served };
writeFileSync(join(target, 'boombapbot-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`assets: ${MACHINE} panel art copied to plugins/vst3/web/public`);

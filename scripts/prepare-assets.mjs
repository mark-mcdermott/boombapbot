#!/usr/bin/env node
// Puts the engine, the worklet and the kit samples where the site can serve
// them, and writes the manifest the editor reads to find them.
//
//   node scripts/prepare-assets.mjs         production: no faceplate photos
//   node scripts/prepare-assets.mjs --dev   also copies local faceplate photos
//
// Faceplate photos in misc/assets are owner-supplied and their rights are not
// recorded yet. They are copied for local development only. A production
// build includes them only when BOOMBAPBOT_INCLUDE_FACEPLATES=1 is set, which
// should happen only once they are cleared for distribution.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'apps/site/public');
const dev = process.argv.includes('--dev');
const includeFaceplates = dev || process.env.BOOMBAPBOT_INCLUDE_FACEPLATES === '1';

function fail(message) {
  console.error(`prepare-assets: ${message}`);
  process.exit(1);
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 10);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ---- Engine ----------------------------------------------------------------

const wasmSource = join(root, 'build/wasm/boombapbot-engine.wasm');
if (!existsSync(wasmSource)) {
  fail(
    'build/wasm/boombapbot-engine.wasm is missing.\n' +
      '  Run ./scripts/setup-emsdk.sh once, then pnpm build:wasm.',
  );
}

const engineDir = join(publicDir, 'engine');
rmSync(engineDir, { recursive: true, force: true });
mkdirSync(engineDir, { recursive: true });

const wasmBytes = readFileSync(wasmSource);
const wasmName = `boombapbot-engine.${hash(wasmBytes)}.wasm`;
writeFileSync(join(engineDir, wasmName), wasmBytes);

// The worklet is bundled on its own: an AudioWorklet module cannot share the
// page's bundle, and it must not depend on the DOM or the network.
const worklet = await build({
  entryPoints: [join(root, 'packages/editor/src/engine/worklet/processor.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
});
const workletBytes = worklet.outputFiles[0].contents;
const workletName = `boombapbot-worklet.${hash(workletBytes)}.js`;
writeFileSync(join(engineDir, workletName), workletBytes);

// ---- Kits ------------------------------------------------------------------

const kitsDir = join(publicDir, 'kits');
rmSync(kitsDir, { recursive: true, force: true });
const manifestDir = join(root, 'packages/contracts/data/kits');
let sampleCount = 0;
for (const file of readdirSync(manifestDir).filter((name) => name.endsWith('.kit.json'))) {
  const kit = readJson(join(manifestDir, file));
  for (const [role, voice] of Object.entries(kit.voices)) {
    const source = join(root, 'assets', kit.assetBase, voice.file);
    if (!existsSync(source)) {
      fail(`${kit.id} ${role} points at ${kit.assetBase}/${voice.file}, which does not exist.\n  Run pnpm kits:generate.`);
    }
    const target = join(publicDir, kit.assetBase, voice.file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
    sampleCount += 1;
  }
}

// ---- Faceplate photos ------------------------------------------------------

const faceplateDir = join(publicDir, 'faceplates');
// Always start clean so photos copied by an earlier dev run cannot leak into
// a production build.
rmSync(faceplateDir, { recursive: true, force: true });
const faceplates = {};
if (includeFaceplates) {
  const panelDir = join(root, 'packages/contracts/data/panels');
  for (const file of readdirSync(panelDir).filter((name) => name.endsWith('.panel.json'))) {
    const panel = readJson(join(panelDir, file));
    const source = join(root, 'misc/assets', panel.faceplate.file);
    if (!existsSync(source)) continue;
    mkdirSync(faceplateDir, { recursive: true });
    cpSync(source, join(faceplateDir, panel.faceplate.file));
    faceplates[panel.id] = `faceplates/${panel.faceplate.file}`;
  }
}

// ---- Manifest --------------------------------------------------------------

const manifest = {
  engine: { worklet: `engine/${workletName}`, wasm: `engine/${wasmName}` },
  kits: '',
  faceplates,
};
writeFileSync(join(publicDir, 'boombapbot-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const photos = Object.keys(faceplates);
console.log(
  `prepare-assets: engine ${wasmName} (${wasmBytes.length} bytes), worklet ${workletName} ` +
    `(${workletBytes.length} bytes), ${sampleCount} samples, ` +
    (photos.length > 0 ? `faceplate photos for ${photos.join(', ')}` : 'no faceplate photos'),
);

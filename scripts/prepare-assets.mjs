#!/usr/bin/env node
// Puts the engine, the worklet, the kit samples and the faceplate images
// where the site can serve them, and writes the manifest the editor reads to
// find them.
//
//   node scripts/prepare-assets.mjs         production
//   node scripts/prepare-assets.mjs --dev   also uses local faceplate originals
//
// Faceplates committed under assets/faceplates are cleared for distribution
// and are included for every kit the editor offers. Images in misc/assets are
// the owner's local originals: they are used with --dev only and never reach
// a production build.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'apps/site/public');
const dev = process.argv.includes('--dev');
const includeLocalFaceplates = dev;

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

// ---- Faceplates -----------------------------------------------------------
//
// A faceplate image comes from one of two places, looked up by the file name
// in the panel manifest:
//
//   assets/faceplates/  committed and cleared for distribution. Always used.
//   misc/assets/        the owner's local originals, ignored by git. Used for
//                       local development only, never in a production build.

const faceplateDir = join(publicDir, 'faceplates');
// Always start clean so images copied by an earlier dev run cannot leak into
// a production build.
rmSync(faceplateDir, { recursive: true, force: true });
const faceplates = {};
const localOnly = [];
const panelDir = join(root, 'packages/contracts/data/panels');
// A kit that is held back never shows its panel, so its photograph would
// ship without the credit its licence asks for. Leave it out.
const offered = new Set(readJson(join(root, 'packages/contracts/data/offered-kits.json')));
for (const file of readdirSync(panelDir).filter((name) => name.endsWith('.panel.json'))) {
  const panel = readJson(join(panelDir, file));
  if (!offered.has(panel.kit)) continue;
  const cleared = join(root, 'assets/faceplates', panel.faceplate.file);
  const local = join(root, 'misc/assets', panel.faceplate.file);
  let source = null;
  if (existsSync(cleared)) {
    source = cleared;
  } else if (includeLocalFaceplates && existsSync(local)) {
    source = local;
    localOnly.push(panel.id);
  }
  if (!source) continue;
  mkdirSync(faceplateDir, { recursive: true });
  cpSync(source, join(faceplateDir, panel.faceplate.file));
  faceplates[panel.id] = `faceplates/${panel.faceplate.file}`;
}

// ---- Manifest --------------------------------------------------------------

const manifest = {
  engine: { worklet: `engine/${workletName}`, wasm: `engine/${wasmName}` },
  kits: '',
  faceplates,
};
writeFileSync(join(publicDir, 'boombapbot-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const shown = Object.keys(faceplates);
console.log(
  `prepare-assets: engine ${wasmName} (${wasmBytes.length} bytes), worklet ${workletName} ` +
    `(${workletBytes.length} bytes), ${sampleCount} samples, ` +
    (shown.length > 0 ? `faceplates for ${shown.join(', ')}` : 'no faceplates') +
    (localOnly.length > 0 ? ` (local originals, dev only: ${localOnly.join(', ')})` : ''),
);

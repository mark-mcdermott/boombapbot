#!/usr/bin/env node
// Puts the engine, the worklet and the machine's panel image where the site can
// serve them, and writes the manifest the editor reads to find them.
//
//   node scripts/prepare-assets.mjs         production
//   node scripts/prepare-assets.mjs --dev   also uses local faceplate originals
//
// The panel image committed in the machine's art folder is cleared for distribution.
// Images in misc/assets are the owner's local originals: they are used with
// --dev only and never reach a production build.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'apps/site/public');
const dev = process.argv.includes('--dev');
const includeLocalFaceplates = dev;
// The drum machine this build is. The site imports the same one.
const machine = process.env.BOOMBAPBOT_MACHINE ?? '808';
const machineDir = join(root, 'packages', `machine-${machine}`);

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

const wasmSource = join(root, `build/wasm/boombapbot-engine-${machine}.wasm`);
if (!existsSync(wasmSource)) {
  fail(
    `build/wasm/boombapbot-engine-${machine}.wasm is missing.\n` +
      '  Run ./scripts/setup-emsdk.sh once, then pnpm build:wasm.',
  );
}

const engineDir = join(publicDir, 'engine');
rmSync(engineDir, { recursive: true, force: true });
mkdirSync(engineDir, { recursive: true });

const wasmBytes = readFileSync(wasmSource);
const wasmName = `boombapbot-engine-${machine}.${hash(wasmBytes)}.wasm`;
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

// ---- Faceplate ------------------------------------------------------------
//
// The faceplate image comes from one of two places, looked up by the file
// name in the panel manifest:
//
//   <machine>/art/      committed and cleared for distribution. Always used.
//   misc/assets/        the owner's local originals, ignored by git. Used for
//                       local development only, never in a production build.

// Sounds are synthesised by the engine now; a folder left by an earlier build
// must not ship.
rmSync(join(publicDir, 'kits'), { recursive: true, force: true });
const faceplateDir = join(publicDir, 'faceplates');
// Always start clean so an image copied by an earlier dev run cannot leak
// into a production build.
rmSync(faceplateDir, { recursive: true, force: true });
// A machine with a panel manifest names one faceplate image in it.
const panelPath = join(machineDir, 'data', `${machine}.panel.json`);
const panel = existsSync(panelPath) ? readJson(panelPath) : null;
let faceplate = null;
let localOnly = false;
if (panel) {
  const cleared = join(machineDir, 'art', panel.faceplate.file);
  const local = join(root, 'misc/assets', panel.faceplate.file);
  localOnly = !existsSync(cleared) && includeLocalFaceplates && existsSync(local);
  const source = existsSync(cleared) ? cleared : localOnly ? local : null;
  if (source) {
    mkdirSync(faceplateDir, { recursive: true });
    cpSync(source, join(faceplateDir, panel.faceplate.file));
    faceplate = `faceplates/${panel.faceplate.file}`;
  }
}

// ---- Panel art ---------------------------------------------------------------
//
// A machine without one ships every image committed in its art folder, at
// the same paths under machines/<id>/. Only that folder is read: nothing
// from misc/assets can get in this way.

const IMAGE = /\.(webp|png|svg|jpe?g)$/;

/** Every image under a folder, as paths relative to it. */
function imagesIn(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? imagesIn(join(dir, entry.name), `${prefix}${entry.name}/`)
      : IMAGE.test(entry.name)
        ? [`${prefix}${entry.name}`]
        : [],
  );
}

const machinesDir = join(publicDir, 'machines');
rmSync(machinesDir, { recursive: true, force: true });
const artDir = join(machineDir, 'art');
let art;
let artCount = 0;
if (!panel && existsSync(artDir)) {
  for (const file of imagesIn(artDir)) {
    const target = join(machinesDir, machine, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(artDir, file), target);
    artCount += 1;
  }
  art = `machines/${machine}/`;
}

// ---- Manifest --------------------------------------------------------------

const manifest = {
  machine,
  engine: { worklet: `engine/${workletName}`, wasm: `engine/${wasmName}` },
  faceplate,
  art,
};
writeFileSync(join(publicDir, 'boombapbot-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `prepare-assets: machine ${machine}, engine ${wasmName} (${wasmBytes.length} bytes), worklet ${workletName} ` +
    `(${workletBytes.length} bytes), ` +
    (art ? `${artCount} art file(s)` : faceplate ? `faceplate ${panel.faceplate.file}` : 'no faceplate') +
    (localOnly ? ' (a local original, dev only)' : ''),
);

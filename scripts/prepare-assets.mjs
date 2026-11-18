#!/usr/bin/env node
// Puts the engine, the worklet and the machine's panel art where the site can
// serve them, and writes the manifest the editor reads to find them.
//
// Only what is committed in the machine's art folder is used. The owner's
// originals in misc/assets never reach a build.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'apps/site/public');
// The drum machine this build is. The site imports the same one.
const machine = process.env.BOOMBAPBOT_MACHINE ?? 'ritm12';
const machineDir = join(root, 'packages', `machine-${machine}`);

function fail(message) {
  console.error(`prepare-assets: ${message}`);
  process.exit(1);
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 10);
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

// ---- Panel art ---------------------------------------------------------------
//
// Every image committed in the machine's art folder, at the same paths under
// machines/<id>/.

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
if (existsSync(artDir)) {
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
  // A machine whose panel is one drawn faceplate names it here. None in this repository does.
  faceplate: null,
  art,
};
writeFileSync(join(publicDir, 'boombapbot-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `prepare-assets: machine ${machine}, engine ${wasmName} (${wasmBytes.length} bytes), worklet ${workletName} ` +
    `(${workletBytes.length} bytes), ${art ? `${artCount} art file(s)` : 'no panel art'}`,
);

#!/usr/bin/env node
// Checks the production build of the site: the page, the engine, the worklet
// and every kit sample must resolve from the built output, and the engine
// must not need shared memory (so no cross-origin isolation headers).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [join(root, 'apps/site/dist'), join(root, 'apps/site/.vercel/output/static')];
const dist = candidates.find((dir) => existsSync(join(dir, 'index.html')));
const problems = [];
const notes = [];

function check(condition, message) {
  if (!condition) problems.push(message);
  return Boolean(condition);
}

if (!dist) {
  console.error('check-build: no built site found. Run pnpm build.');
  process.exit(1);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
check(html.includes('astro-island'), 'index.html has no client island for the editor');
check(/<script|component-url=/.test(html), 'index.html loads no script');

const manifestPath = join(dist, 'boombapbot-assets.json');
if (check(existsSync(manifestPath), 'boombapbot-assets.json is missing from the build')) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  // Engine: a valid module that exports the render call and imports no memory.
  const wasmPath = join(dist, manifest.engine.wasm);
  if (check(existsSync(wasmPath), `engine file ${manifest.engine.wasm} is missing`)) {
    const module = new WebAssembly.Module(readFileSync(wasmPath));
    const exports = WebAssembly.Module.exports(module).map((entry) => entry.name);
    const imports = WebAssembly.Module.imports(module);
    for (const name of ['snare_engine_render', 'snare_engine_play', 'snare_kit_set_voice', 'snare_midi_export', 'memory']) {
      check(exports.includes(name), `engine does not export ${name}`);
    }
    check(
      imports.every((entry) => entry.kind === 'function'),
      'engine imports memory or a table; it must own its memory so no shared memory is needed',
    );
    notes.push(`engine ${manifest.engine.wasm}: ${exports.length} exports, ${imports.length} import(s)`);
  }

  // Worklet: a self-contained script that registers the processor.
  const workletPath = join(dist, manifest.engine.worklet);
  if (check(existsSync(workletPath), `worklet file ${manifest.engine.worklet} is missing`)) {
    const source = readFileSync(workletPath, 'utf8');
    check(source.includes('boombapbot-engine'), 'worklet does not register the boombapbot-engine processor');
    check(!/\bimport\s*[({"']/.test(source), 'worklet has an import; it must be a single self-contained file');
    check(!source.includes('SharedArrayBuffer'), 'worklet refers to SharedArrayBuffer');
    notes.push(`worklet ${manifest.engine.worklet}: ${source.length} bytes`);
  }

  // Kits: every file a manifest names is in the build.
  const kitDir = join(root, 'packages/contracts/data/kits');
  let samples = 0;
  for (const file of readdirSync(kitDir).filter((name) => name.endsWith('.kit.json'))) {
    const kit = JSON.parse(readFileSync(join(kitDir, file), 'utf8'));
    for (const voice of Object.values(kit.voices)) {
      const path = join(dist, manifest.kits, kit.assetBase, voice.file);
      if (check(existsSync(path) && statSync(path).size > 44, `sample ${kit.assetBase}/${voice.file} is missing`)) {
        samples += 1;
      }
    }
  }
  notes.push(`${samples} kit samples`);

  // Faceplate photos must not ship unless that was asked for explicitly.
  const photos = Object.keys(manifest.faceplates ?? {});
  const allowed = process.env.BOOMBAPBOT_INCLUDE_FACEPLATES === '1';
  check(
    allowed || (photos.length === 0 && !existsSync(join(dist, 'faceplates'))),
    'the build contains faceplate photos. Rebuild with pnpm build (not after pnpm dev output) ' +
      'or set BOOMBAPBOT_INCLUDE_FACEPLATES=1 once the photos are cleared for distribution.',
  );
  notes.push(photos.length > 0 ? `faceplate photos: ${photos.join(', ')}` : 'no faceplate photos');
}

if (problems.length > 0) {
  console.error(`check-build: ${problems.length} problem(s) in ${dist}`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`check-build: ok (${dist.replace(`${root}/`, '')})`);
for (const note of notes) console.log(`  - ${note}`);

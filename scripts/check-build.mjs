#!/usr/bin/env node
// Checks the production build of the site: the page, the engine, the worklet
// and every kit sample must resolve from the built output, the engine must
// not need shared memory (so no cross-origin isolation headers), and only
// committed faceplate images may be present.

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

  // Every faceplate in the build must be one committed under assets/faceplates.
  // The owner's local originals in misc/assets must never ship.
  const shipped = Object.entries(manifest.faceplates ?? {});
  for (const [id, path] of shipped) {
    const name = path.split('/').pop();
    // The photographs are Creative Commons works that must be credited.
    const panel = JSON.parse(
      readFileSync(join(root, 'packages/contracts/data/panels', `${id}.panel.json`), 'utf8'),
    );
    const credit = panel.faceplate.credit;
    check(
      credit && credit.author && credit.title && credit.source && credit.licence && credit.licenceUrl,
      `the ${id} faceplate ships without a credit. Add faceplate.credit to ${id}.panel.json.`,
    );
    const record = join(root, 'assets/faceplates/README.md');
    check(
      existsSync(record) && readFileSync(record, 'utf8').includes(name),
      `assets/faceplates/README.md has no provenance entry for ${name}`,
    );
    const committed = join(root, 'assets/faceplates', name);
    const built = join(dist, path);
    check(existsSync(built), `faceplate ${path} is listed but missing from the build`);
    check(
      existsSync(committed) &&
        existsSync(built) &&
        readFileSync(committed).equals(readFileSync(built)),
      `the ${id} faceplate in the build is not the committed assets/faceplates/${name}. ` +
        'Local originals from misc/assets must not ship; rebuild with pnpm build.',
    );
  }
  if (existsSync(join(dist, 'faceplates'))) {
    const listed = new Set(shipped.map(([, path]) => path.split('/').pop()));
    for (const name of readdirSync(join(dist, 'faceplates'))) {
      check(listed.has(name), `faceplates/${name} is in the build but not in the asset manifest`);
    }
  }
  notes.push(
    shipped.length > 0 ? `faceplates: ${shipped.map(([id]) => id).join(', ')}` : 'no faceplates',
  );
}

if (problems.length > 0) {
  console.error(`check-build: ${problems.length} problem(s) in ${dist}`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`check-build: ok (${dist.replace(`${root}/`, '')})`);
for (const note of notes) console.log(`  - ${note}`);

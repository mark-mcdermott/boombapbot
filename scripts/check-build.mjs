#!/usr/bin/env node
// Checks the production build of the site: the page, the engine and the
// worklet must resolve from the built output, the engine must not need
// shared memory (so no cross-origin isolation headers), and only the
// committed faceplate image may be present.
//
//   node scripts/check-build.mjs                          the local build
//   node scripts/check-build.mjs .vercel/output/static    what `vercel build` made

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The drum machine the build is meant to be.
const machine = process.env.BOOMBAPBOT_MACHINE ?? 'ritm12';
const machineDir = join(root, 'packages', `machine-${machine}`);
const asked = process.argv[2];
const candidates = asked
  ? [resolve(asked)]
  : [join(root, 'apps/site/dist/client'), join(root, 'apps/site/.vercel/output/static')];
const dist = candidates.find((dir) => existsSync(join(dir, 'index.html')));
const problems = [];
const notes = [];

/** Every image under a folder, as paths relative to it. */
function imagesIn(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? imagesIn(join(dir, entry.name), `${prefix}${entry.name}/`)
      : /\.(webp|png|svg|jpe?g)$/.test(entry.name)
        ? [`${prefix}${entry.name}`]
        : [],
  );
}

function check(condition, message) {
  if (!condition) problems.push(message);
  return Boolean(condition);
}

if (!dist) {
  console.error(`check-build: no built site found${asked ? ` in ${asked}` : ''}. Run pnpm build.`);
  process.exit(1);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
check(html.includes('astro-island'), 'index.html has no client island for the editor');
check(/<script|component-url=/.test(html), 'index.html loads no script');

const manifestPath = join(dist, 'boombapbot-assets.json');
if (check(existsSync(manifestPath), 'boombapbot-assets.json is missing from the build')) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  check(manifest.machine === machine, `the build is the ${manifest.machine} but ${machine} was asked for`);

  // Engine: the one built for this machine, a valid module that exports the
  // render call and imports no memory.
  check(
    manifest.engine.wasm.startsWith(`engine/boombapbot-engine-${machine}.`),
    `engine file ${manifest.engine.wasm} was not built for the ${machine}`,
  );
  const wasmPath = join(dist, manifest.engine.wasm);
  if (check(existsSync(wasmPath), `engine file ${manifest.engine.wasm} is missing`)) {
    const module = new WebAssembly.Module(readFileSync(wasmPath));
    const exports = WebAssembly.Module.exports(module).map((entry) => entry.name);
    const imports = WebAssembly.Module.imports(module);
    for (const name of ['snare_engine_render', 'snare_engine_play', 'snare_engine_set_pattern', 'snare_synth_render', 'snare_midi_export', 'memory']) {
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

  // Sounds are synthesised by the engine, so no sample files may ship.
  check(!existsSync(join(dist, 'kits')), 'the build has a kits folder; sounds are synthesised, not shipped');

  // Panel art in the build must be, byte for byte, what is committed in the
  // machine's art folder, and nothing else may sit beside it.
  const artDir = join(machineDir, 'art');
  if (manifest.art) {
    check(manifest.art === `machines/${machine}/`, `the art is served from ${manifest.art}, not from this machine's folder`);
    check(existsSync(join(artDir, 'README.md')), "the machine's art folder has no README.md saying where its art comes from");
    const built = imagesIn(join(dist, 'machines', machine));
    const committed = imagesIn(artDir);
    check(built.length > 0, 'the build lists panel art but ships none');
    for (const file of built) {
      const source = join(artDir, file);
      check(
        existsSync(source) && readFileSync(source).equals(readFileSync(join(dist, 'machines', machine, file))),
        `machines/${machine}/${file} in the build is not the committed art/${file}`,
      );
    }
    for (const file of committed) check(built.includes(file), `the committed art/${file} is missing from the build`);
    notes.push(`art ${manifest.art}: ${built.length} file(s)`);
  }
  if (existsSync(join(dist, 'machines'))) {
    for (const name of readdirSync(join(dist, 'machines'))) {
      check(manifest.art === `machines/${name}/`, `the build has art for the ${name}, which is not the machine it is`);
    }
  }

  // A faceplate in the build must be the one committed in the machine's art folder.
  // The owner's local originals in misc/assets must never ship.
  const path = manifest.faceplate;
  if (path) {
    const name = path.split('/').pop();
    // A faceplate is either artwork drawn for boombapbot, or a Creative Commons
    // photograph that must be credited.
    const panelFile = `${machine}.panel.json`;
    const panel = JSON.parse(readFileSync(join(machineDir, 'data', panelFile), 'utf8'));
    const credit = panel.faceplate.credit;
    check(name === panel.faceplate.file, `the build ships ${name}, which is not the panel's faceplate`);
    check(
      panel.faceplate.original === true ||
        (credit && credit.author && credit.title && credit.source && credit.licence && credit.licenceUrl),
      `the faceplate ships without a credit. Add faceplate.credit to ${panelFile}, ` +
        'or set faceplate.original if it was drawn in this repository.',
    );
    const record = join(machineDir, 'art/README.md');
    check(
      existsSync(record) && readFileSync(record, 'utf8').includes(name),
      `the machine's art/README.md has no provenance entry for ${name}`,
    );
    const committed = join(machineDir, 'art', name);
    const built = join(dist, path);
    check(existsSync(built), `faceplate ${path} is listed but missing from the build`);
    check(
      existsSync(committed) && existsSync(built) && readFileSync(committed).equals(readFileSync(built)),
      `the faceplate in the build is not the committed art/${name} of the machine. ` +
        'Local originals from misc/assets must not ship; rebuild with pnpm build.',
    );
  }
  if (existsSync(join(dist, 'faceplates'))) {
    for (const name of readdirSync(join(dist, 'faceplates'))) {
      check(path === `faceplates/${name}`, `faceplates/${name} is in the build but not in the asset manifest`);
    }
  }
  if (!manifest.art) notes.push(path ? `faceplate ${path}` : 'no faceplate');
}

if (problems.length > 0) {
  console.error(`check-build: ${problems.length} problem(s) in ${dist}`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`check-build: ok (${dist.replace(`${root}/`, '')})`);
for (const note of notes) console.log(`  - ${note}`);

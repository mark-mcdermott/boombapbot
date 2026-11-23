// Renders a beat through each of the upgrade's effects, so they can be heard
// before any control reaches them: one WAV for the dry beat, and one for each
// effect at each amount.
//
//   pnpm audition [beat.boombapbot.json] [--out build/auditions] [--measures 4]
//
// With no beat it plays the committed fixture. It needs the native render
// tool, which "pnpm build:engine" builds.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createProjectCodec } from '../packages/contracts/src/index';
import type { EffectKind, EngineSetup } from '../packages/editor/src/engine/index';
import { documentRitm12 } from '../packages/machine-ritm12/src/document/index';
import { engineSetup } from '../packages/machine-ritm12/src/engine';

const PAID_EFFECTS: EffectKind[] = ['crusher', 'tape', 'pump', 'filter', 'vinyl', 'phaser'];
const AMOUNTS = [0.5, 1];
const RATE = 48000;

// pnpm runs a script from the repository's root.
const repoRoot = process.cwd();
const renderTool = join(repoRoot, 'build/native/boombapbot-render-ritm12');
const fixture = join(repoRoot, 'packages/machine-ritm12/fixtures/four-patterns.project.json');

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback;
}

function beatPath(): string {
  const named = process.argv.slice(2).find((arg, index, args) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'));
  return named ? resolve(named) : fixture;
}

function fail(message: string): never {
  console.error(`audition: ${message}`);
  process.exit(1);
}

if (!existsSync(renderTool)) fail(`${renderTool} is missing. Run "pnpm build:engine" first.`);

const measures = Number.parseInt(option('--measures', '4'), 10);
if (!Number.isInteger(measures) || measures < 1 || measures > 64) fail('--measures is a whole number from 1 to 64');

const beat = beatPath();
if (!existsSync(beat)) fail(`${beat} is not there`);
const parsed = createProjectCodec([documentRitm12]).parseText(readFileSync(beat, 'utf8'));
if (!parsed.ok) fail(`${beat} is not a beat saved from the site or the plugin (a .boombapbot.json file): ${parsed.errors.join('; ')}`);
const project = parsed.project;

const outDir = resolve(option('--out', join(repoRoot, 'build/auditions')));
mkdirSync(outDir, { recursive: true });
// What the render tool is handed. It is no beat, and is not left beside the audio.
const runDir = mkdtempSync(join(tmpdir(), 'boombapbot-audition-'));

function render(name: string, setup: EngineSetup): void {
  const run = join(runDir, `${name}.json`);
  const wav = join(outDir, `${name}.wav`);
  writeFileSync(run, JSON.stringify({ rate: RATE, setup, pattern: project.panel.pattern, measures }));
  execFileSync(renderTool, ['--setup', run, '--out', wav]);
  console.log(wav);
}

const dry: EngineSetup = { ...engineSetup(project), effect: undefined };
render('dry', dry);
for (const kind of PAID_EFFECTS) {
  for (const wet of AMOUNTS) render(`${kind}-${Math.round(wet * 100)}`, { ...dry, effect: { kind, wet } });
}
rmSync(runDir, { recursive: true });

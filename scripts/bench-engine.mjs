#!/usr/bin/env node
// Worst-case load on the WebAssembly engine: every lane hits on every step at
// the fastest tempo with the longest-tailed kit, rendered in 128-frame blocks
// as an AudioWorklet would. Reports how much faster than real time it runs.
//
//   node scripts/bench-engine.mjs [seconds] [sampleRate]
//
// The result depends on the machine; it is a sanity check, not a guarantee
// for phones. Device baselines still have to be measured on devices.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seconds = Number(process.argv[2] ?? 60);
const sampleRate = Number(process.argv[3] ?? 48000);
const block = 128;

const module = new WebAssembly.Module(readFileSync(join(root, 'build/wasm/boombapbot-engine.wasm')));
const imports = {};
for (const entry of WebAssembly.Module.imports(module)) {
  (imports[entry.module] ??= {})[entry.name] = () => 0;
}
const x = new WebAssembly.Instance(module, imports).exports;
x._initialize?.();

function readWav(path) {
  const bytes = readFileSync(path);
  const frames = bytes.readUInt32LE(40) / 2;
  const pcm = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) pcm[i] = bytes.readInt16LE(44 + i * 2) / 32768;
  return { pcm, rate: bytes.readUInt32LE(24) };
}

const roles = JSON.parse(readFileSync(join(root, 'packages/contracts/data/roles.json'), 'utf8')).roles;
const kit = JSON.parse(readFileSync(join(root, 'packages/contracts/data/kits/808.kit.json'), 'utf8'));
const engine = x.snare_engine_create(sampleRate);
const handle = x.snare_kit_create();
for (const role of roles) {
  const voice = kit.voices[role.id];
  const { pcm, rate } = readWav(join(root, 'assets', kit.assetBase, voice.file));
  const pointer = x.malloc(pcm.length * 4);
  new Float32Array(x.memory.buffer).set(pcm, pointer / 4);
  // No choke groups here: chokes free voices, and this run wants the pool full.
  x.snare_kit_set_voice(handle, role.index, pointer, pcm.length, 1, rate, voice.gain, voice.pan, 0);
  x.free(pointer);
}
x.snare_engine_commit_kit(engine, handle);
x.snare_engine_set_tempo(engine, 300);
for (const role of roles) {
  for (let step = 0; step < 16; step += 1) x.snare_engine_set_step(engine, role.index, step, 127);
}
x.snare_engine_play(engine);

const left = x.malloc(block * 4);
const right = x.malloc(block * 4);
const blocks = Math.ceil((seconds * sampleRate) / block);
let peakVoices = 0;
let worstBlockMs = 0;
const started = performance.now();
for (let i = 0; i < blocks; i += 1) {
  const before = performance.now();
  x.snare_engine_render(engine, left, right, block);
  worstBlockMs = Math.max(worstBlockMs, performance.now() - before);
  peakVoices = Math.max(peakVoices, x.snare_engine_active_voices(engine));
}
const elapsed = (performance.now() - started) / 1000;
const out = new Float32Array(x.memory.buffer, left, block);
const finite = out.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1);

const blockMs = (block / sampleRate) * 1000;
console.log(`rendered ${seconds}s at ${sampleRate} Hz in ${elapsed.toFixed(2)}s`);
console.log(`  ${(seconds / elapsed).toFixed(0)}x real time, ${((elapsed / seconds) * 100).toFixed(2)}% of one core`);
console.log(`  slowest ${block}-frame block ${worstBlockMs.toFixed(3)} ms of a ${blockMs.toFixed(2)} ms budget`);
console.log(`  peak voices ${peakVoices} of 64, stolen ${x.snare_engine_stolen_voices(engine)}`);
console.log(`  output finite and within [-1, 1]: ${finite}`);
if (!finite) process.exit(1);

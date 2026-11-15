import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot, wasmPath } from './helpers';

/**
 * The engine's C ABI is written down in three places: the header, the list
 * of functions the WebAssembly build exports, and the TypeScript bridge that
 * calls them. A function missing from the export list only fails at runtime,
 * inside the audio worklet, so the three are compared here.
 */

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function sorted(names: Iterable<string>): string[] {
  return [...new Set(names)].sort();
}

const header = read('engine/include/boombapbot/engine.h');
const cmake = read('engine/CMakeLists.txt');
const bridge = read('packages/editor/src/engine/wasm-engine.ts');

const declared = sorted([...header.matchAll(/\b(snare_[a-z0-9_]+)\s*\(/g)].map((match) => match[1]!));
const exportList = sorted(
  /set\(SNARE_WASM_EXPORTS([^)]*)\)/
    .exec(cmake)![1]!
    .split(/\s+/)
    .filter((name) => name.startsWith('snare_')),
);
const bridged = sorted([...bridge.matchAll(/\b(snare_[a-z0-9_]+)\s*\(/g)].map((match) => match[1]!));

describe('engine exports', () => {
  it('exports every function the header declares, and nothing else', () => {
    expect(declared.length).toBeGreaterThan(20);
    expect(exportList).toEqual(declared);
  });

  it('builds a module that exports exactly that list', () => {
    const module = new WebAssembly.Module(readFileSync(wasmPath));
    const built = sorted(
      WebAssembly.Module.exports(module)
        .filter((entry) => entry.kind === 'function' && entry.name.startsWith('snare_'))
        .map((entry) => entry.name),
    );
    expect(built).toEqual(exportList);
  });

  it('declares in the bridge every function the module exports', () => {
    expect(bridged).toEqual(exportList);
  });
});

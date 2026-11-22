import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { codec, loadFixture } from './helpers';

/**
 * The VST3 plugin saves beats as project documents. Its self-test writes the
 * four-patterns fixture back out and checks the result, byte for byte, against
 * the file read here, so the plugin and the site agree on what a beat file is.
 */
const savedByPlugin = readFileSync(new URL('../fixtures/saved-by-plugin.project.json', import.meta.url), 'utf8');

describe('a beat the plugin saved', () => {
  it('opens as a РИТМ-12 project with nothing to report', () => {
    const result = codec.parseText(savedByPlugin);
    expect(result).toMatchObject({ ok: true, changes: [] });
  });

  it('is the beat the plugin was given, under an id and a date of its own', () => {
    const result = codec.parseText(savedByPlugin);
    if (!result.ok) throw new Error(result.errors.join('; '));
    const original = loadFixture();
    expect(result.project.id).not.toBe(original.id);
    expect({
      ...result.project,
      id: original.id,
      createdAt: original.createdAt,
      updatedAt: original.updatedAt,
    }).toEqual(original);
  });
});

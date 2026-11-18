import { describe, expect, it } from 'vitest';
import { EditorRuntime, type KeyValueStorage } from '@boombapbot/editor';
import { machineRitm12 } from '../src';
import { earlier, newProject } from './helpers';

/** The earlier machine's beat, as far as these tests look into it. */
const earlierBeat = () => earlier(2) as { id: string; name: string };

const runtime = (storage: KeyValueStorage | null = null) =>
  new EditorRuntime({ baseUrl: '/', storage, machine: machineRitm12 });

describe('loading a saved beat onto the machine', () => {
  it('keeps the id of a beat of its own, so a save replaces the one it was loaded from', () => {
    const machine = runtime();
    const saved = { ...newProject(), id: 'from-the-account', name: 'From the account' };
    expect(machine.loadSavedBeat(JSON.parse(JSON.stringify(saved)))).toMatchObject({
      adopted: false,
      project: { id: 'from-the-account' },
    });
    expect(machine.store.getState().notice?.message).toBe(
      'Loaded “From the account” from your account. Undo brings back the previous beat.',
    );
  });

  it('makes a new beat of one from the earlier machine, so a save cannot replace the one in the account', () => {
    const machine = runtime();
    const saved = earlierBeat();
    const loaded = machine.loadSavedBeat(saved);
    if (!loaded) throw new Error('not loaded');
    expect(loaded.adopted).toBe(true);
    expect(loaded.project.machine).toBe('ritm12');
    expect(loaded.project.id).not.toBe(saved.id);
    expect(machine.store.getState().project.id).toBe(loaded.project.id);
    expect(machine.store.getState().notice?.message).toContain('The one in your account is as it was.');
    expect(machine.store.getState().notice?.details?.length).toBeGreaterThan(1);
  });

  it('gives a draft left by the earlier machine a new id too', () => {
    const left = earlierBeat();
    const items = new Map([['boombapbot.draft.v2', JSON.stringify(left)]]);
    const storage: KeyValueStorage = {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
      removeItem: (key) => void items.delete(key),
    };
    const { project } = runtime(storage).store.getState();
    expect(project.name).toBe(left.name);
    expect(project.id).not.toBe(left.id);
  });
});

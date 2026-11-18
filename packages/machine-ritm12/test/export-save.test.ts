import { describe, expect, it } from 'vitest';
import { EditorRuntime, type ExportedFile, type SaveFile } from '@boombapbot/editor';
import { machineRitm12 } from '../src';

const runtime = (save: SaveFile) => new EditorRuntime({ baseUrl: '/', storage: null, machine: machineRitm12, save });

describe('where an exported file goes', () => {
  it('hands a project export to whoever saves files for this shell', async () => {
    const saved: ExportedFile[] = [];
    const machine = runtime((file) => {
      saved.push(file);
      return true;
    });
    await machine.exportProject();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe('starter-beat.boombapbot.json');
    expect(saved[0]?.type).toBe('application/json');
    expect(JSON.parse(String(saved[0]?.data))).toMatchObject({ machine: 'ritm12', name: 'Starter beat' });
    expect(machine.store.getState().notice).toBeNull();
  });

  it('says nothing when the person turns the file down', async () => {
    const machine = runtime(() => false);
    await machine.exportProject();
    expect(machine.store.getState().notice).toBeNull();
  });

  it('says so when the file could not be saved', async () => {
    const machine = runtime(() => Promise.reject(new Error('the phone is full')));
    await machine.exportProject();
    expect(machine.store.getState().notice).toMatchObject({
      kind: 'error',
      message: 'The project export failed: the phone is full',
    });
  });
});

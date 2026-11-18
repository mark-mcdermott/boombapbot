import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorRuntime, type ExportedFile, type SaveFile } from '@boombapbot/editor';
import '../../editor/src/engine/wav-worker';
import { wasmPath } from '../../editor/test/helpers';
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

/** The Worker's own scope, as `wav-worker.ts` uses it. Here it is the test's. */
const scope = globalThis as unknown as {
  onmessage(event: { data: unknown }): void;
  postMessage(report: unknown): void;
};

/** Stands in for the Worker a WAV renders in: its real message handler answers on a later turn. */
class InlineWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;

  postMessage(sent: unknown, transfer: Transferable[]): void {
    const received = structuredClone(sent, { transfer });
    queueMicrotask(() => {
      scope.postMessage = (data) => this.onmessage?.({ data });
      scope.onmessage({ data: received });
    });
  }

  terminate(): void {}
}

/** Answers the two things a render fetches: the asset manifest and the engine. */
function serveEngine(): void {
  const manifest = { machine: 'ritm12', engine: { worklet: 'engine/worklet.js', wasm: 'engine/engine.wasm' }, faceplate: null };
  vi.stubGlobal('fetch', async (url: string) =>
    url.endsWith('.wasm') ? new Response(readFileSync(wasmPath('ritm12'))) : Response.json(manifest),
  );
  vi.stubGlobal('Worker', InlineWorker);
}

describe('a WAV export on its way to the person', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A save that waits to be answered, as a share sheet waits for the person. */
  function heldSave() {
    let answer: (kept: boolean) => void = () => undefined;
    let tellAsked: (file: ExportedFile) => void = () => undefined;
    const asked = new Promise<ExportedFile>((resolve) => {
      tellAsked = resolve;
    });
    const save: SaveFile = (file) => {
      tellAsked(file);
      return new Promise<boolean>((resolve) => {
        answer = resolve;
      });
    };
    return { asked, save, answer: (kept: boolean) => answer(kept) };
  }

  it('says it is being saved while the person decides, and that it was exported once they keep it', async () => {
    serveEngine();
    const held = heldSave();
    const machine = runtime(held.save);
    const exporting = machine.exportWav();
    const file = await held.asked;
    expect(file.name).toBe('starter-beat.wav');
    expect(String.fromCharCode(...(file.data as Uint8Array).subarray(0, 4))).toBe('RIFF');
    expect(machine.store.getState().wavExport).toEqual({ state: 'saving' });

    // Another is not started while this one waits.
    await machine.exportWav();
    expect(machine.store.getState().wavExport).toEqual({ state: 'saving' });

    held.answer(true);
    await exporting;
    expect(machine.store.getState().wavExport).toMatchObject({ state: 'done' });
  });

  it('says nothing was exported when the person turns it down', async () => {
    serveEngine();
    const held = heldSave();
    const machine = runtime(held.save);
    const exporting = machine.exportWav();
    await held.asked;
    held.answer(false);
    await exporting;
    expect(machine.store.getState().wavExport).toBeNull();
    expect(machine.store.getState().notice).toBeNull();
  });
});

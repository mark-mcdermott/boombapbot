import type { WavJob, WavJobReport } from './wav-job';

/** The part of a Worker a render uses, so a test can stand in for one. */
export interface WavWorker {
  onmessage: ((event: MessageEvent<WavJobReport>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(job: WavJob, transfer: Transferable[]): void;
  terminate(): void;
}

const startWorker = (): WavWorker => new Worker(new URL('./wav-worker.ts', import.meta.url), { type: 'module' });

/**
 * Renders a WAV off the main thread and resolves with the file's bytes.
 * Each render has a Worker of its own, which is gone, with the memory the
 * render took, as soon as it has answered.
 */
export function renderWav(
  job: WavJob,
  onProgress: (fraction: number) => void,
  start: () => WavWorker = startWorker,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const worker = start();
    const fail = (message: string) => {
      worker.terminate();
      reject(new Error(message));
    };
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        onProgress(data.fraction);
      } else if (data.type === 'done') {
        worker.terminate();
        resolve(data.bytes);
      } else {
        fail(data.message);
      }
    };
    worker.onerror = (event) => fail(event.message || 'the export worker could not start');
    worker.postMessage(job, [job.wasm]);
  });
}

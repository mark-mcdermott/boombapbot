/**
 * The Worker a WAV export renders in, so a long one never holds the page
 * still. It takes one job, reports as it goes and answers with the file.
 */
import { runWavJob, type WavJob, type WavJobReport } from './wav-job';

/** The part of a dedicated Worker's scope this file uses. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<WavJob>) => void) | null;
  postMessage(report: WavJobReport, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event) => {
  try {
    const bytes = runWavJob(event.data, (fraction) => scope.postMessage({ type: 'progress', fraction }));
    scope.postMessage({ type: 'done', bytes }, [bytes.buffer]);
  } catch (error) {
    scope.postMessage({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
};

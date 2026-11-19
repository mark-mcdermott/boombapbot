import type { WavExport } from '../state/store';

/** Why another WAV cannot be asked for yet, while one is under way. */
export function wavExportWait(wav: WavExport | null): string | null {
  if (wav?.state === 'rendering') return 'One is rendering now';
  if (wav?.state === 'saving') return 'One is being saved now';
  return null;
}

/** Where a WAV export stands, in a sentence a screen reader can be told. */
export function wavExportSaid(wav: WavExport): string {
  switch (wav.state) {
    case 'rendering':
      return 'Rendering the WAV…';
    case 'saving':
      return 'Saving the WAV…';
    case 'done':
      return `WAV exported at ${new Date(wav.at).toLocaleTimeString()}`;
    case 'error':
      return 'The WAV export failed';
  }
}

/** The same, short enough for the chip outside the sheet, with the render counted up. */
export function wavExportShort(wav: WavExport): string {
  switch (wav.state) {
    case 'rendering':
      return `${wavExportSaid(wav)} ${Math.round(wav.progress * 100)}%`;
    case 'done':
      return 'WAV exported';
    default:
      return wavExportSaid(wav);
  }
}

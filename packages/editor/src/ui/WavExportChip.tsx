import { Check, CircleAlert } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { WavExport } from '../state/store';
import { useEditorState } from './context';
import { wavExportSaid, wavExportShort } from './wav-export-words';

/** How long how an export ended stays on screen. */
const SHOWN_FOR_MS: Partial<Record<WavExport['state'], number>> = { done: 5000, error: 8000 };

interface WavExportChipProps {
  /** Where it mounts: inside the editor, out of the footer, so a shell's `below` keeps it too. */
  host: HTMLElement | null;
  /** Whether the settings sheet is open. It says all this itself, so the chip stands aside. */
  sheetOpen: boolean;
  openSheet(): void;
}

/**
 * Where a WAV export stands once the settings sheet is closed: a small chip
 * at the foot of the screen that counts the render up, says how it ended and
 * then goes. Pressed, it opens the sheet again. A screen reader is told when
 * it starts and how it ends, not every step of the count.
 */
export function WavExportChip({ host, sheetOpen, openSheet }: WavExportChipProps) {
  const wav = useEditorState((state) => state.wavExport);
  const [gone, setGone] = useState<WavExport | null>(null);

  useEffect(() => {
    const ms = wav ? SHOWN_FOR_MS[wav.state] : undefined;
    if (ms === undefined) return;
    const timer = window.setTimeout(() => setGone(wav), ms);
    return () => window.clearTimeout(timer);
  }, [wav]);

  if (!host) return null;
  const shown = wav !== null && wav !== gone && !sheetOpen;
  const progress = wav?.state === 'rendering' ? wav.progress : 1;

  return createPortal(
    <>
      <span className="sb-visually-hidden" role="status" data-testid="wav-export-chip-said">
        {shown ? wavExportSaid(wav) : ''}
      </span>
      {shown && (
        <button
          type="button"
          className="sb-export-chip"
          data-testid="wav-export-chip"
          data-state={wav.state}
          onClick={openSheet}
        >
          {wav.state === 'done' ? (
            <Check className="sb-export-chip-mark" aria-hidden="true" />
          ) : wav.state === 'error' ? (
            <CircleAlert className="sb-export-chip-mark" aria-hidden="true" />
          ) : (
            <span
              className="sb-export-chip-meter"
              aria-hidden="true"
              style={{ '--progress': progress } as CSSProperties}
            />
          )}
          <span>{wavExportShort(wav)}</span>
          <span className="sb-visually-hidden">, open settings</span>
        </button>
      )}
    </>,
    host,
  );
}

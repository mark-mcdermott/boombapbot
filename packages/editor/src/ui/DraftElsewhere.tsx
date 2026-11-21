import { useId, useState } from 'react';
import { useEditorState, useRuntime } from './context';
import { draftElsewhereText } from './draft-words';

/** Shown while another tab owns the draft, with the one way to bring it here. */
export function DraftElsewhere({ device }: { device: boolean }) {
  const runtime = useRuntime();
  const elsewhere = useEditorState((state) => state.draftState === 'elsewhere');
  const [moving, setMoving] = useState(false);
  const questionId = useId();
  if (!elsewhere) return null;

  const workHere = async (): Promise<void> => {
    setMoving(true);
    try {
      await runtime.workHere();
    } finally {
      setMoving(false);
    }
  };

  return (
    <div
      className="sb-notice sb-draft-elsewhere"
      data-kind="error"
      data-testid="draft-elsewhere"
      role="group"
      aria-labelledby={questionId}
    >
      <div className="sb-notice-body">
        <p id={questionId}>{draftElsewhereText({ device })}</p>
        <div className="sb-draft-choices">
          <button
            className="sb-button"
            type="button"
            data-testid="draft-work-here"
            disabled={moving}
            onClick={() => void workHere()}
          >
            {moving ? 'Moving the beat here…' : `Work in this ${device ? 'window' : 'tab'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

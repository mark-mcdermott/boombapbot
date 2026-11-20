import { Segmented } from '@boombapbot/editor';
import { countHits, isEmptyPattern } from '../document';
import { remembersAnything, selectedPattern } from '../session';
import { useEditorState, useRuntime } from './context';
import { setScript, useLettering, useScript, type Script } from './lettering';

/** РИТМ-12's own buttons in settings, after undo and redo. */
export function SettingsActions() {
  const { session } = useRuntime();
  const empty = useEditorState((state) => isEmptyPattern(selectedPattern(state.project)));
  const remembers = useEditorState((state) => remembersAnything(state.project));
  return (
    <>
      <button type="button" className="sb-button" data-testid="starter" onClick={() => session.loadStarterPatterns()}>
        Starter patterns
      </button>
      <button type="button" className="sb-button sb-button-danger" data-testid="clear" disabled={empty} onClick={() => session.clearPattern()}>
        Clear pattern
      </button>
      <button
        type="button"
        className="sb-button sb-button-danger"
        data-testid="clear-everything"
        disabled={!remembers}
        onClick={() => session.clearEverything()}
      >
        Clear everything
      </button>
    </>
  );
}

/** РИТМ-12's own line in the settings status list. */
export function StatusLines() {
  const hits = useEditorState((state) => countHits(selectedPattern(state.project)));
  const patterns = useLettering().patterns;
  const name = patterns[useEditorState((state) => state.project.panel.pattern)];
  return (
    <span data-testid="hit-count">
      {hits} {hits === 1 ? 'hit' : 'hits'} in pattern {name}
    </span>
  );
}

const SCRIPTS: Array<{ value: Script; label: string; testId: string }> = [
  { value: 'russian', label: 'Russian', testId: 'lettering-russian' },
  { value: 'english', label: 'English', testId: 'lettering-english' },
];

/** Whether the machine is lettered in its own Russian or in English: its screen, keys and panel. */
export function Options() {
  const script = useScript();
  return (
    <>
      <span className="sb-label">
        Panel lettering
      </span>
      <Segmented label="Panel lettering" className="sb-segmented-fill" value={script} onChange={setScript} options={SCRIPTS} />
    </>
  );
}

/** РИТМ-12 has nothing to add about itself in settings. */
export function Notes() {
  return null;
}

export function KeysHelp() {
  return (
    <>
      Keys: <kbd>Space</kbd> start or stop · arrows move between steps and turn knobs · <kbd>Enter</kbd> presses a
      step or a button · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo
    </>
  );
}

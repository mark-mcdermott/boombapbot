import { useEditorState, useRuntime } from './context';
import { draftStatusText } from './draft-words';
import { CloseIcon, RedoIcon, UndoIcon } from './icons';

export function PatternActions() {
  const { store, machine } = useRuntime();
  const canUndo = useEditorState((state) => state.canUndo);
  const canRedo = useEditorState((state) => state.canRedo);
  return (
    <div className="sb-actions" role="toolbar" aria-label="Pattern actions">
      <button type="button" className="sb-button" data-testid="undo" disabled={!canUndo} onClick={() => store.undo()}>
        <UndoIcon />
        <span>Undo</span>
      </button>
      <button type="button" className="sb-button" data-testid="redo" disabled={!canRedo} onClick={() => store.redo()}>
        <RedoIcon />
        <span>Redo</span>
      </button>
      <machine.SettingsActions />
    </div>
  );
}

export function NoticeBanner() {
  const { store } = useRuntime();
  const notice = useEditorState((state) => state.notice);
  if (!notice) return null;
  return (
    <div
      className="sb-notice"
      data-kind={notice.kind}
      data-testid="notice"
      role={notice.kind === 'error' ? 'alert' : 'status'}
    >
      <div className="sb-notice-body">
        <p>{notice.message}</p>
        {notice.details && notice.details.length > 0 ? (
          <ul>
            {notice.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <button type="button" className="sb-icon-button" aria-label="Dismiss" onClick={() => store.dismissNotice()}>
        <CloseIcon />
      </button>
    </div>
  );
}

const AUDIO_TEXT: Record<string, string> = {
  idle: 'Audio is off. Press play to turn it on.',
  starting: 'Starting audio…',
  running: 'Audio is running',
  suspended: 'The browser paused the audio. Press play to bring it back.',
  error: 'Audio could not start',
};

interface StatusBarProps {
  /** Whether a beat can also be saved to an account here. A shell with no site behind it has none. */
  accounts: boolean;
  device: boolean;
}

export function StatusBar({ accounts, device }: StatusBarProps) {
  const audioStatus = useEditorState((state) => state.audioStatus);
  const audioError = useEditorState((state) => state.audioError);
  const draftState = useEditorState((state) => state.draftState);
  const draftSavedAt = useEditorState((state) => state.draftSavedAt);
  const draftOrigin = useEditorState((state) => state.draftOrigin);
  const { machine } = useRuntime();

  const saved = draftStatusText({ state: draftState, savedAt: draftSavedAt, accounts, device });

  return (
    <div className="sb-status">
      <span data-testid="draft-status" data-state={draftState} data-origin={draftOrigin}>
        {saved}
        {draftOrigin === 'restored' ? ' · restored from your last visit' : ''}
      </span>
      <span data-testid="audio-status" data-state={audioStatus}>
        {AUDIO_TEXT[audioStatus]}
        {audioError ? `: ${audioError}` : ''}
      </span>
      <machine.StatusLines />
    </div>
  );
}

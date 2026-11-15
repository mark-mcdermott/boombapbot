import { useEditorState, useRuntime } from './context';
import { PlayIcon, StopIcon } from './icons';

/** Starts and stops the beat. The machine carries it; phones also dock one. */
export function PlayButton({ className = '', testId }: { className?: string; testId: string }) {
  const runtime = useRuntime();
  const playing = useEditorState((state) => state.playing);
  const starting = useEditorState((state) => state.audioStatus === 'starting');

  return (
    <button
      type="button"
      className={`sb-play ${className}`}
      data-testid={testId}
      data-playing={playing}
      aria-pressed={playing}
      aria-busy={starting}
      onClick={() => void runtime.togglePlay()}
    >
      {playing ? <StopIcon /> : <PlayIcon />}
      <span>{playing ? 'Stop' : starting ? 'Starting' : 'Play'}</span>
    </button>
  );
}

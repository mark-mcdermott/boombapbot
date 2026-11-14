import { useEffect, useState } from 'react';
import { EditorRuntime } from '../runtime';
import { RuntimeContext, useEditorState, useRuntime } from './context';
import { HardwarePanel } from './HardwarePanel';
import { PlayIcon, StopIcon } from './icons';
import { Header } from './Header';
import { KitPicker } from './KitPicker';
import { NoticeBanner, PatternActions, StatusBar } from './StatusBar';
import { StepGrid } from './StepGrid';
import { Transport } from './Transport';
import { VelocityLane } from './VelocityLane';

export interface BoombapbotEditorProps {
  /** Base URL the site is served from. */
  baseUrl?: string;
}

declare global {
  interface Window {
    /** Diagnostics for automated tests and support. Not a stable API. */
    __boombapbot?: {
      debug(): ReturnType<EditorRuntime['debug']>;
      renderLoop(sampleRate?: number): Promise<{
        frames: number;
        sampleRate: number;
        peak: number;
        rms: number;
        events: Array<{ frame: number; step: number; role: number; velocity: number }>;
      }>;
    };
  }
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button, a, summary, [role="slider"], [role="menuitem"], [role="radio"]') !== null;
}

/** Play and tempo, pinned to the bottom of a phone screen under a long grid. */
function Dock() {
  const runtime = useRuntime();
  const playing = useEditorState((state) => state.playing);
  const bpm = useEditorState((state) => state.project.bpm);
  const kitId = useEditorState((state) => state.project.kit.id);
  return (
    <div className="sb-dock" role="group" aria-label="Quick transport">
      <button
        type="button"
        className="sb-play sb-dock-play"
        data-testid="dock-play"
        data-playing={playing}
        aria-pressed={playing}
        onClick={() => void runtime.togglePlay()}
      >
        {playing ? <StopIcon /> : <PlayIcon />}
        <span>{playing ? 'Stop' : 'Play'}</span>
      </button>
      <span className="sb-dock-info">
        <strong>{bpm}</strong> BPM · kit <strong>{kitId}</strong>
      </span>
    </div>
  );
}

function EditorBody({ runtime }: { runtime: EditorRuntime }) {
  const mode = useEditorState((state) => state.mode);
  const kitId = useEditorState((state) => state.project.kit.id);
  const audioStatus = useEditorState((state) => state.audioStatus);
  const playing = useEditorState((state) => state.playing);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === 'z' && !isTextEntry(event.target)) {
        event.preventDefault();
        if (event.shiftKey) runtime.store.redo();
        else runtime.store.undo();
      } else if (command && event.key.toLowerCase() === 'y' && !isTextEntry(event.target)) {
        event.preventDefault();
        runtime.store.redo();
      } else if (event.key === ' ' && !command && !isTextEntry(event.target) && !isActivatable(event.target)) {
        // Space plays and stops, except where it already activates a control.
        event.preventDefault();
        void runtime.togglePlay();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runtime]);

  return (
    <div
      className="sb-app"
      data-testid="editor"
      data-kit={kitId}
      data-mode={mode}
      data-audio={audioStatus}
      data-playing={playing}
    >
      <Header />
      <NoticeBanner />
      <div className="sb-controls">
        <Transport />
        <KitPicker />
      </div>
      {mode === 'modern' ? (
        <>
          <StepGrid />
          <VelocityLane />
        </>
      ) : (
        <HardwarePanel />
      )}
      <PatternActions />
      <StatusBar />
      <Dock />
      <p className="sb-footnote">
        Keys: <kbd>Space</kbd> play or stop · arrows move between steps · <kbd>Enter</kbd> toggles a step ·{' '}
        <kbd>+</kbd> <kbd>−</kbd> change velocity · <kbd>A</kbd> accent · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo
      </p>
    </div>
  );
}

/** The boombapbot beat editor. Client-only: it needs Web Audio and storage. */
export function BoombapbotEditor({ baseUrl = '/' }: BoombapbotEditorProps) {
  const [runtime] = useState(() => new EditorRuntime({ baseUrl }));

  useEffect(() => {
    runtime.attach();
    window.__boombapbot = {
      debug: () => runtime.debug(),
      renderLoop: async (sampleRate = 44100) => {
        const render = await runtime.renderLoop(sampleRate);
        let peak = 0;
        let sum = 0;
        for (const sample of render.left) {
          peak = Math.max(peak, Math.abs(sample));
          sum += sample * sample;
        }
        return {
          frames: render.left.length,
          sampleRate,
          peak,
          rms: Math.sqrt(sum / render.left.length),
          events: render.events,
        };
      },
    };
    return () => {
      runtime.detach();
      delete window.__boombapbot;
    };
  }, [runtime]);

  return (
    <RuntimeContext.Provider value={runtime}>
      <EditorBody runtime={runtime} />
    </RuntimeContext.Provider>
  );
}

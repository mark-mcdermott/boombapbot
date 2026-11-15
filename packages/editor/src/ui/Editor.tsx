import { useEffect, useRef, useState } from 'react';
import { OFFERED_KIT_IDS, isKitId } from '@boombapbot/contracts';
import { EditorRuntime } from '../runtime';
import { Brand } from './Brand';
import { RuntimeContext, useEditorState } from './context';
import { Footer } from './Footer';
import { HardwarePanel } from './HardwarePanel';
import { NoticeBanner } from './StatusBar';
import { StepGrid } from './StepGrid';
import { PlayButton } from './Transport';
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
      /** Switches to any defined kit, including ones the page holds back. */
      setKit(id: string): void;
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
  const bpm = useEditorState((state) => state.project.bpm);
  const kitId = useEditorState((state) => state.project.kit.id);
  return (
    <div className="sb-dock" role="group" aria-label="Quick transport">
      <PlayButton className="sb-dock-play" testId="dock-play" />
      <span className="sb-dock-info">
        <strong>{bpm}</strong> BPM
        {OFFERED_KIT_IDS.length > 1 ? (
          <>
            {' '}
            · kit <strong>{kitId}</strong>
          </>
        ) : null}
      </span>
    </div>
  );
}

function EditorBody({ runtime }: { runtime: EditorRuntime }) {
  const mode = useEditorState((state) => state.mode);
  const kitId = useEditorState((state) => state.project.kit.id);
  const audioStatus = useEditorState((state) => state.audioStatus);
  const playing = useEditorState((state) => state.playing);
  const sheetContainer = useRef<HTMLDivElement>(null);

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
      <header className="sb-header">
        <Brand />
      </header>
      <NoticeBanner />
      {mode === 'modern' ? (
        <>
          <StepGrid />
          <VelocityLane />
        </>
      ) : (
        <HardwarePanel />
      )}
      <Footer sheetContainer={sheetContainer} />
      <Dock />
      <div ref={sheetContainer} className="sb-sheet-root" />
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
      setKit: (id) => {
        if (isKitId(id)) runtime.store.setKit(id);
      },
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

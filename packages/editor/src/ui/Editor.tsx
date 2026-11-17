import { useEffect, useRef, useState } from 'react';
import type { ProjectBase } from '@boombapbot/contracts';
import type { Machine, MachineSession } from '../machine';
import { EditorRuntime } from '../runtime';
import { RuntimeContext, useEditorState, useRuntime } from './context';
import { CookieNotice } from './CookieNotice';
import { Footer } from './Footer';
import { Header } from './Header';
import { NoticeBanner } from './StatusBar';
import { PlayButton } from './PlayButton';
import { Settings } from './Settings';

export interface BoombapbotEditorProps<
  Document extends ProjectBase,
  Transient extends object,
  Session extends MachineSession<Document, Transient>,
> {
  /** The drum machine this editor is. */
  machine: Machine<Document, Transient, Session>;
  /** Base URL the site is served from. */
  baseUrl?: string;
}

declare global {
  interface Window {
    /** Diagnostics for automated tests and support. Not a stable API. */
    __boombapbot?: {
      debug(): ReturnType<EditorRuntime['debug']>;
      /** The step and pattern the engine last reported, or -1 while stopped. */
      playing(): { step: number; pattern: number };
      renderLoop(sampleRate?: number): Promise<{
        frames: number;
        sampleRate: number;
        peak: number;
        rms: number;
        events: Array<{ frame: number; step: number; track: number; accent: boolean; pattern: number }>;
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

/** Start/stop and the tempo, pinned to the bottom of a phone screen. */
function Dock() {
  const { machine } = useRuntime();
  const bpm = useEditorState((state) => Math.round(machine.bpm(state.project)));
  return (
    <div className="sb-dock" role="group" aria-label="Quick transport">
      <PlayButton className="sb-dock-play" testId="dock-play" />
      <span className="sb-dock-info">
        <strong data-testid="dock-bpm">{bpm}</strong> BPM
      </span>
    </div>
  );
}

function EditorBody({ runtime, baseUrl }: { runtime: EditorRuntime; baseUrl: string }) {
  const audioStatus = useEditorState((state) => state.audioStatus);
  const playing = useEditorState((state) => state.playing);
  const modals = useRef<HTMLDivElement>(null);

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
      } else if (runtime.session.keyDown?.(event)) {
        return;
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
      data-audio={audioStatus}
      data-playing={playing}
    >
      <Header baseUrl={baseUrl} />
      <NoticeBanner />
      <runtime.machine.Panel />
      <div className="sb-below-machine">
        <CookieNotice baseUrl={baseUrl} />
        <Footer baseUrl={baseUrl} container={modals} settings={<Settings container={modals} />} />
      </div>
      <Dock />
      <div ref={modals} className="sb-modal-root" />
    </div>
  );
}

/** The boombapbot beat editor. Client-only: it needs Web Audio and storage. */
export function BoombapbotEditor<
  Document extends ProjectBase,
  Transient extends object,
  Session extends MachineSession<Document, Transient>,
>({ machine, baseUrl = '/' }: BoombapbotEditorProps<Document, Transient, Session>) {
  const [runtime] = useState(() => new EditorRuntime({ baseUrl, machine }));

  useEffect(() => {
    runtime.attach();
    window.__boombapbot = {
      debug: () => runtime.debug(),
      playing: () => {
        const { currentStep, currentPattern } = runtime.store.getState();
        return { step: currentStep, pattern: currentPattern };
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

  // The context is not generic. A machine's own hooks give its panel the types back.
  const shared = runtime as unknown as EditorRuntime;
  return (
    <RuntimeContext.Provider value={shared}>
      <EditorBody runtime={shared} baseUrl={baseUrl} />
    </RuntimeContext.Provider>
  );
}

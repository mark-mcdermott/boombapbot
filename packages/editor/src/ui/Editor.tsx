import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProjectBase } from '@boombapbot/contracts';
import type { AudioFactory } from '../engine/engine-audio';
import type { Machine, MachineSession } from '../machine';
import { EditorRuntime } from '../runtime';
import type { KeyValueStorage } from '../state/draft-storage';
import type { SaveFile } from '../state/project-io';
import { RuntimeContext, useEditorState, useRuntime } from './context';
import { CookieNotice } from './CookieNotice';
import { DraftElsewhere } from './DraftElsewhere';
import { Footer } from './Footer';
import { Header } from './Header';
import { NoticeBanner } from './StatusBar';
import { PlayButton } from './PlayButton';
import { LightToggle } from './LightToggle';
import { Settings } from './Settings';
import type { BelowMachine } from './ShellFooter';

export interface BoombapbotEditorProps<
  Document extends ProjectBase,
  Transient extends object,
  Session extends MachineSession<Document, Transient>,
> {
  /** The drum machine this editor is. */
  machine: Machine<Document, Transient, Session>;
  /** Base URL the site is served from. */
  baseUrl?: string;
  /** Where the draft is kept. The browser's IndexedDB when not given. */
  storage?: KeyValueStorage | null;
  /** Where an exported file goes. A download when not given. */
  save?: SaveFile;
  /**
   * What plays the engine. The page's own worklet when not given; a shell
   * that runs the engine natively hands in a controller for that one.
   */
  audio?: AudioFactory;
  /**
   * What sits under the machine in place of the site's notice and footer.
   * For a shell with no site behind it, which has no shop or account to
   * offer.
   */
  below?: BelowMachine;
  /**
   * Whether there is an account to save a beat to. The site has one. A
   * shell says so when what it puts under the machine has the account button.
   */
  accounts?: boolean;
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

interface EditorBodyProps {
  runtime: EditorRuntime;
  baseUrl: string;
  below?: BelowMachine;
  accounts?: boolean;
}

function EditorBody({ runtime, baseUrl, below, accounts = !below }: EditorBodyProps) {
  const device = Boolean(below);
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

  const { light } = runtime.machine;
  const settings = (
    <>
      {light ? <LightToggle light={light} container={modals} /> : null}
      <Settings container={modals} accounts={accounts} device={device} />
    </>
  );
  return (
    <div
      className="sb-app"
      data-testid="editor"
      data-audio={audioStatus}
      data-playing={playing}
    >
      <Header baseUrl={baseUrl} />
      <NoticeBanner />
      <DraftElsewhere device={device} />
      <runtime.machine.Panel />
      <div className="sb-below-machine">
        {below ? (
          below(settings, modals)
        ) : (
          <>
            <CookieNotice baseUrl={baseUrl} />
            <Footer baseUrl={baseUrl} container={modals} settings={settings} />
          </>
        )}
      </div>
      <Dock />
      <div ref={modals} className="sb-modal-root" />
    </div>
  );
}

/**
 * The boombapbot beat editor. Client-only: it needs Web Audio and storage.
 * With no store of the shell's own it shows once the browser's has opened.
 */
export function BoombapbotEditor<
  Document extends ProjectBase,
  Transient extends object,
  Session extends MachineSession<Document, Transient>,
>({ machine, baseUrl = '/', storage, save, audio, below, accounts }: BoombapbotEditorProps<Document, Transient, Session>) {
  const [runtime, setRuntime] = useState(() =>
    storage === undefined ? null : new EditorRuntime({ baseUrl, machine, storage, save, audio }),
  );

  useEffect(() => {
    if (runtime) return;
    let mounted = true;
    void EditorRuntime.open({ baseUrl, machine, save, audio }).then((opened) => {
      if (mounted) setRuntime(opened);
    });
    return () => {
      mounted = false;
    };
  }, [runtime, baseUrl, machine, save, audio]);

  return runtime ? <OpenEditor runtime={runtime} baseUrl={baseUrl} below={below} accounts={accounts} /> : null;
}

interface OpenEditorProps<
  Document extends ProjectBase,
  Transient extends object,
  Session extends MachineSession<Document, Transient>,
> {
  runtime: EditorRuntime<Document, Transient, Session>;
  baseUrl: string;
  below?: BelowMachine;
  accounts?: boolean;
}

function OpenEditor<
  Document extends ProjectBase,
  Transient extends object,
  Session extends MachineSession<Document, Transient>,
>({ runtime, baseUrl, below, accounts }: OpenEditorProps<Document, Transient, Session>) {
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
      <EditorBody runtime={shared} baseUrl={baseUrl} below={below} accounts={accounts} />
    </RuntimeContext.Provider>
  );
}

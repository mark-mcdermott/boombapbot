/**
 * The run in which an app checks itself, shared by every shell that runs
 * the engine natively. The page plays the beat as a person at the keyboard
 * would, and reports what it saw and what the engine says of itself. A
 * shell starts it only when whoever launched the app asked for a check.
 */

/** What a shell lends the check. */
export interface ShellCheckHost {
  /** What was asked for: `play`, or `reopen`, which also makes the engine again halfway. */
  mode: string;
  /** What the native engine and its sound device say of themselves now. */
  engine(): Promise<EngineSnapshot>;
  /** As if the sound device had said the engine's stream cannot go on. */
  lose(): Promise<void>;
  /**
   * The files the run has exported, for a shell that writes an export where
   * the check can find it. A shell that hands exports to a share sheet,
   * which would wait for a person, leaves this out and exports are skipped.
   */
  exports?(): Promise<ExportedRecord[]>;
  /** Hands over the report, which says whether the check passed. */
  report(report: ShellCheckReport): Promise<void>;
}

/** The part of a native engine's account of itself the check reads. Shells add their own. */
export interface EngineSnapshot {
  peakEver?: number;
  [detail: string]: unknown;
}

export interface ExportedRecord {
  name: string;
  bytes: number;
  /** The file's first bytes, as text. */
  begins: string;
}

export type ShellCheckReport = { ok: boolean; mode: string; failed?: string } & Record<string, unknown>;

/** The quietest peak that counts as sound, and so as a beat that played. */
const AUDIBLE_PEAK = 0.01;
const LISTEN_MS = 3000;
const EXPORTS = ['export-wav', 'export-midi', 'export-project'];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<Found>(what: string, test: () => Found | null | undefined | false, ms = 20_000): Promise<Found> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const found = test();
    if (found) return found;
    await wait(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A press of the mouse, as the menus and buttons of the page take one. */
function press(element: Element): void {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const Kind = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    element.dispatchEvent(new Kind(type, { bubbles: true, cancelable: true, button: 0 }));
  }
}

const control = (testId: string) =>
  until(`the ${testId} control`, () => document.querySelector(`[data-testid="${testId}"]`));

const space = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));

function size(element: Element | null) {
  if (!element) return null;
  const { width, height } = element.getBoundingClientRect();
  return { width: Math.round(width), height: Math.round(height) };
}

function editor() {
  const found = window.__boombapbot;
  if (!found) throw new Error('the editor is not on the page');
  return found;
}

/** Listens for a while, noting each step the page shows, then asks both sides how it went. */
async function listen(host: ShellCheckHost) {
  const steps = new Set<number>();
  const end = Date.now() + LISTEN_MS;
  while (Date.now() < end) {
    steps.add(editor().playing().step);
    await wait(20);
  }
  const { project: _project, ...page } = editor().debug();
  return { page, stepsShown: [...steps].sort((a, b) => a - b), engine: await host.engine() };
}

const heard = (peak: number | undefined) => peak !== undefined && peak > AUDIBLE_PEAK;

export async function runShellCheck(host: ShellCheckHost): Promise<void> {
  const report: ShellCheckReport = { ok: false, mode: host.mode };
  try {
    await until('the machine', () => window.__boombapbot && document.querySelector('[data-testid="plate"], .rt-phone'));
    await until('the panel art', () => [...document.images].every((image) => image.complete));
    const machine = document.querySelector<HTMLElement>('[data-testid="editor"]');
    report.shown = {
      window: { width: window.innerWidth, height: window.innerHeight },
      editor: size(machine),
      plate: size(document.querySelector('[data-testid="plate"]')),
      phonePanel: document.querySelector('.rt-phone') !== null,
      images: document.images.length,
      imagesLoaded: [...document.images].filter((image) => image.naturalWidth > 0).length,
      controls: document.querySelectorAll('button, [role="slider"]').length,
      audioBeforePlay: machine?.dataset.audio,
    };

    space();
    await until('the beat to start', () => editor().playing().step >= 0);
    const playing = await listen(host);
    report.playing = playing;

    if (host.mode === 'reopen') {
      await host.lose();
      await until('the engine to be made again', () => editor().debug().soundsSent > playing.page.soundsSent);
      report.reopened = await listen(host);
    }

    // What an export renders, on the page: the WebAssembly engine still has that job.
    const loop = await editor().renderLoop();
    report.offline = { frames: loop.frames, peak: loop.peak, hits: loop.events.length };

    space();
    await until('the beat to stop', () => editor().playing().step < 0);
    await wait(300);
    report.stopped = { audio: machine?.dataset.audio, playing: machine?.dataset.playing, engine: await host.engine() };

    const { exports } = host;
    if (exports) {
      // Each kind of export, through the settings sheet as a person would ask for it.
      press(await control('settings'));
      await control('settings-modal');
      for (const [count, kind] of EXPORTS.entries()) {
        press(await control('export-menu'));
        press(await control(kind));
        let exported: ExportedRecord[] = [];
        await until(`the ${kind} file`, () => {
          void exports().then((files) => (exported = files));
          return exported.length > count;
        });
        report.exports = exported;
      }
    }
    report.notice = document.querySelector('[role="alert"]')?.textContent ?? null;
    report.ok = heard(playing.page.stats?.peakEver) && heard(playing.engine.peakEver);
  } catch (error) {
    report.failed = error instanceof Error ? error.message : String(error);
  }
  await host.report(report);
}

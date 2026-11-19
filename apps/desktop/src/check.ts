import type { ExportedRecord, ShellCheckHost } from '@boombapbot/editor/shell-check';
import type { TauriCalls } from './tauri-engine';

/**
 * Starts the run in which the app checks itself, if whoever launched it
 * asked for one (`BOOMBAPBOT_DESKTOP_CHECK`, see src-tauri/src/check.rs).
 * The check is loaded only then.
 */
export async function checkIfAsked(invoke: TauriCalls['invoke']): Promise<void> {
  const mode = await invoke<string | null>('check_mode');
  if (!mode) return;
  const { runShellCheck } = await import('@boombapbot/editor/shell-check');
  const host: ShellCheckHost = {
    mode,
    engine: () => invoke('check_engine'),
    lose: () => invoke('check_lose'),
    exports: () => invoke<ExportedRecord[]>('check_exports'),
    report: (report) => invoke('check_report', { report }),
  };
  await runShellCheck(host);
}

import type { PluginListenerHandle } from '@capacitor/core';
import type { EngineReport, NativeEngineBridge, NativeEngineCommand } from '@boombapbot/editor';
import type { EngineSnapshot, ShellCheckReport } from '@boombapbot/editor/shell-check';

/** The name the plug-in in native-engine/ registers under (`jsName`). */
export const ENGINE_PLUGIN = 'BoombapbotEngine';
/** The event every report from the engine arrives on. */
export const REPORT_EVENT = 'report';

/** What the plug-in answers, as `registerPlugin` gives it, or a fake in tests. */
export interface EnginePlugin {
  open(): Promise<{ sampleRate: number }>;
  send(options: { commands: NativeEngineCommand[] }): Promise<void>;
  close(): Promise<void>;
  addListener(event: typeof REPORT_EVENT, listener: (report: EngineReport) => void): Promise<PluginListenerHandle>;
  /** What a check run was asked for, or null in any other run. */
  checkMode(): Promise<{ mode: string | null }>;
  checkEngine(): Promise<EngineSnapshot>;
  checkLose(): Promise<void>;
  checkReport(options: { report: ShellCheckReport }): Promise<void>;
}

/** Carries the engine's messages to the engine the phone runs natively, and its reports back. */
export function pluginEngine(plugin: EnginePlugin): NativeEngineBridge {
  return {
    open: () => plugin.open(),
    send: (commands) => plugin.send({ commands }),
    listen: async (onReport) => {
      const handle = await plugin.addListener(REPORT_EVENT, onReport);
      return () => void handle.remove();
    },
    close: () => plugin.close(),
  };
}

/**
 * Starts the run in which the app checks itself, if whoever launched it
 * asked for one (`BOOMBAPBOT_CHECK`, see the README). The check is loaded
 * only then. Exports go to the share sheet, which would wait for a person,
 * so the check leaves them out.
 */
export async function checkIfAsked(plugin: EnginePlugin): Promise<void> {
  const { mode } = await plugin.checkMode();
  if (!mode) return;
  const { runShellCheck } = await import('@boombapbot/editor/shell-check');
  await runShellCheck({
    mode,
    engine: () => plugin.checkEngine(),
    lose: () => plugin.checkLose(),
    report: (report) => plugin.checkReport({ report }),
  });
}

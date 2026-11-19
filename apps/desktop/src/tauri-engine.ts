import type { EngineReport, NativeEngineBridge } from '@boombapbot/editor';

/** The parts of Tauri the app's page uses: its own `invoke` and `listen`, or fakes in tests. */
export interface TauriCalls {
  invoke<Answer>(command: string, args?: Record<string, unknown> | Uint8Array): Promise<Answer>;
  listen<Payload>(event: string, handler: (event: { payload: Payload }) => void): Promise<() => void>;
}

/** The event every report from the engine arrives on (`REPORT_EVENT` in `src-tauri/src/lib.rs`). */
export const REPORT_EVENT = 'engine-report';

/**
 * Carries the engine's messages to the engine the app runs natively, as the
 * commands of `src-tauri/src/lib.rs`, and its reports back.
 */
export function tauriEngine({ invoke, listen }: TauriCalls): NativeEngineBridge {
  return {
    open: () => invoke<{ sampleRate: number }>('engine_open'),
    send: (commands) => invoke<void>('engine_send', { commands }),
    listen: (onReport) => listen<EngineReport>(REPORT_EVENT, (event) => onReport(event.payload)),
    close: () => invoke<void>('engine_close'),
  };
}

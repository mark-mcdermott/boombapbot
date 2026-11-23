import type { EngineReport, NativeEngineBridge, NativeEngineCommand } from '@boombapbot/editor';
import type { Plugin } from './juce';

/** The event the plugin's reports arrive on: where the sequencer is. */
export const REPORT_EVENT = 'report';

/**
 * The engine as the editor sees it, when the engine is the plugin's.
 *
 * In an app the page owns the beat and tells the engine everything: sounds,
 * levels, patterns, tempo. In a plugin the host owns it, as parameters and
 * state, and the page is one more hand on the controls. So the beat crosses
 * whole, as a project document (see `main.tsx`), and of the engine's commands
 * only those that are not part of the beat cross here: a voice key's hit, and
 * play and stop, which in a host mean the sequencer's switch. The host keeps
 * the tempo and the transport.
 */
export function pluginEngine(plugin: Plugin): NativeEngineBridge {
  let report: (report: EngineReport) => void = () => undefined;
  return {
    open: async () => ({ sampleRate: await plugin.call<number>('sampleRate') }),
    send: async (commands: NativeEngineCommand[]) => {
      for (const command of commands) {
        if (command.type === 'synth') report({ type: 'sound', slot: command.sound.sound });
        else if (command.type === 'trigger') void plugin.call('trigger', command.track, command.accent);
        else if (command.type === 'play') void plugin.call('setSequencer', true);
        else if (command.type === 'stop') void plugin.call('setSequencer', false);
      }
    },
    listen: async (onReport) => {
      report = onReport;
      return plugin.on<EngineReport>(REPORT_EVENT, onReport);
    },
    close: async () => undefined,
  };
}

import { createContext, useContext } from 'react';
import { EditorRuntime, useEditorState as useCoreState, useRuntime as useCoreRuntime } from '@boombapbot/editor';
import type { Project } from '../document';
import type { SessionRitm12, StateRitm12, TransientRitm12 } from '../session';

export type RuntimeRitm12 = EditorRuntime<Project, TransientRitm12, SessionRitm12>;

/** The runtime of the editor this panel is in. The panel is only ever mounted by РИТМ-12. */
export function useRuntime(): RuntimeRitm12 {
  return useCoreRuntime() as unknown as RuntimeRitm12;
}

/** Subscribes to one slice of РИТМ-12's state. */
export function useEditorState<Value>(selector: (state: StateRitm12) => Value, same?: (a: Value, b: Value) => boolean): Value {
  return useCoreState((state) => selector(state as StateRitm12), same);
}

/** What a control tells the panel when it has been moved. */
export interface Readout {
  /** Shows a line on the machine's screen for a moment, as it is lettered, and says it in English to a screen reader. */
  say(onScreen: string, spoken: string): void;
  /** Where the panel's pictures are served from, or null until that is known. */
  art(file: string): string | null;
}

export const ReadoutContext = createContext<Readout | null>(null);

export function useReadout(): Readout {
  const readout = useContext(ReadoutContext);
  if (!readout) throw new Error('useReadout must be used inside the РИТМ-12 panel');
  return readout;
}

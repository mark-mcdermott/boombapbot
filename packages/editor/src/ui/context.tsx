import { createContext, useContext, useSyncExternalStore } from 'react';
import type { EditorRuntime } from '../runtime';
import type { EditorState } from '../state/store';

export const RuntimeContext = createContext<EditorRuntime | null>(null);

export function useRuntime(): EditorRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('useRuntime must be used inside <BoombapbotEditor>');
  return runtime;
}

/** Subscribes to one slice of editor state. Select values that are stable. */
export function useEditorState<T>(selector: (state: EditorState) => T): T {
  const { store } = useRuntime();
  const read = () => selector(store.getState());
  return useSyncExternalStore(store.subscribe, read, read);
}

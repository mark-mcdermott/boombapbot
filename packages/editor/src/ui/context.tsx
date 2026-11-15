import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import type { EditorRuntime } from '../runtime';
import type { EditorState } from '../state/store';

export const RuntimeContext = createContext<EditorRuntime | null>(null);

export function useRuntime(): EditorRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('useRuntime must be used inside <BoombapbotEditor>');
  return runtime;
}

/**
 * Subscribes to one slice of editor state. Select values that are stable, or
 * pass `same` to keep the last value while a derived one is unchanged.
 */
export function useEditorState<T>(selector: (state: EditorState) => T, same?: (a: T, b: T) => boolean): T {
  const { store } = useRuntime();
  const last = useRef<{ value: T } | null>(null);
  const read = () => {
    const value = selector(store.getState());
    if (same && last.current && same(last.current.value, value)) return last.current.value;
    last.current = { value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, read, read);
}

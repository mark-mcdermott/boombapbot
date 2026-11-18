import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AssetManifest, EditorRuntime } from '../runtime';
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

/** What the build put where the site serves it, once it has been fetched. Null until then, and if it cannot be. */
export function useAssetManifest(): AssetManifest | null {
  const runtime = useRuntime();
  const [manifest, setManifest] = useState<AssetManifest | null>(null);
  useEffect(() => {
    let live = true;
    runtime
      .loadManifest()
      .then((loaded) => {
        if (live) setManifest(loaded);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [runtime]);
  return manifest;
}

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useEditorState, useRuntime } from '@boombapbot/editor';
import type { Plugin } from './juce';

/** The events the plugin tells the bar things on: whether there is a step to take back, and how a file went. */
const UNDO_EVENT = 'undo';
const SAID_EVENT = 'said';

/** How far the MIDI key is dragged, in pixels, before the drag carries the file out. */
const DRAG_STARTS_AFTER = 8;
/** As long as the site takes a name. */
const NAME_LONGEST = 80;

interface Said {
  words: string;
  problem: boolean;
}

/**
 * What a plugin's window has and the picture of the machine does not: the
 * beat's name, its files, and undo for the patterns. The plugin does the
 * work; this asks for it and shows how it went.
 */
export function Bar({ plugin }: { plugin: Plugin | null }) {
  const runtime = useRuntime();
  const name = useEditorState((state) => state.project.name);
  const [typed, setTyped] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  useEffect(() => {
    if (!plugin) return undefined;
    const stopUndo = plugin.on<boolean>(UNDO_EVENT, setCanUndo);
    const stopSaid = plugin.on<Said>(SAID_EVENT, setSaid);
    return () => {
      stopUndo();
      stopSaid();
    };
  }, [plugin]);

  const keepName = () => {
    if (typed !== null) runtime.store.setName(typed);
    setTyped(null);
  };
  const onNameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    else if (event.key === 'Escape') setTyped(null);
    // A key typed into the name is the name's, and not a key of the machine or the host.
    event.stopPropagation();
  };

  const ask = (what: string) => () => void plugin?.call(what);
  const onMidiDown = (event: PointerEvent<HTMLButtonElement>) => {
    dragFrom.current = { x: event.clientX, y: event.clientY };
    dragged.current = false;
  };
  const onMidiMove = (event: PointerEvent<HTMLButtonElement>) => {
    const from = dragFrom.current;
    if (!from || dragged.current) return;
    if (Math.hypot(event.clientX - from.x, event.clientY - from.y) < DRAG_STARTS_AFTER) return;
    dragged.current = true;
    void plugin?.call('dragMidi');
  };
  const onMidiClick = () => {
    dragFrom.current = null;
    if (!dragged.current) void plugin?.call('saveMidi');
    dragged.current = false;
  };

  return (
    <footer className="pb-bar" data-testid="bar">
      <label className="pb-name">
        <span>Beat</span>
        <input
          type="text"
          value={typed ?? name}
          maxLength={NAME_LONGEST}
          spellCheck={false}
          autoComplete="off"
          aria-label="Beat name"
          data-testid="beat-name"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setTyped(event.currentTarget.value)}
          onBlur={keepName}
          onKeyDown={onNameKey}
        />
      </label>
      <p className="pb-said" role="status" data-problem={said?.problem || undefined} data-testid="said">
        {said?.words}
      </p>
      <div className="pb-keys">
        <button type="button" data-testid="undo" disabled={!plugin || !canUndo} title="Take back the last change to the patterns" onClick={ask('undo')}>
          Undo
        </button>
        <button type="button" data-testid="load-beat" disabled={!plugin} title="Load a beat saved from boombapbot" onClick={ask('loadBeat')}>
          Load
        </button>
        <button type="button" data-testid="save-beat" disabled={!plugin} title="Save this beat as a file boombapbot opens" onClick={ask('saveBeat')}>
          Save
        </button>
        <button
          type="button"
          data-testid="midi"
          disabled={!plugin}
          title="Click to save the shown pattern as a MIDI file, or drag it into the host"
          onPointerDown={onMidiDown}
          onPointerMove={onMidiMove}
          onClick={onMidiClick}
        >
          MIDI
        </button>
      </div>
    </footer>
  );
}

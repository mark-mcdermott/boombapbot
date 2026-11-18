import { beatLimitReached, formatKilobytes, type BeatSummary } from '@boombapbot/contracts';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { deviceBeatLinks } from '../account/beat-links';
import { deleteBeat, fetchBeat, listBeats, replaceBeat, saveNewBeat, type Asked } from '../account/beats';
import { explain } from '../account/client';
import type { EditorRuntime } from '../runtime';
import { RuntimeContext, useEditorState } from './context';

type Loaded =
  | { state: 'loading' }
  | { state: 'failed'; problem: string }
  | { state: 'ready'; beats: BeatSummary[]; limit: number };

/** The one call to the server that is under way, and the beat it is about. */
type Busy = { doing: 'saving' } | { doing: 'loading' | 'deleting'; beat: string } | null;

/** A save the server held back: the cloud copy is newer than the one this device last had. */
interface Conflict {
  beat: BeatSummary;
  updatedAt: string;
}

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function When({ at }: { at: string }) {
  return <time dateTime={at}>{WHEN.format(new Date(at))}</time>;
}

interface BeatRowProps {
  beat: BeatSummary;
  /** The beat a save from the machine would replace. */
  current: boolean;
  busy: Busy;
  onLoad(): void;
  onDelete(): void;
}

function BeatRow({ beat, current, busy, onLoad, onDelete }: BeatRowProps) {
  const [confirming, setConfirming] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const mine = busy && 'beat' in busy && busy.beat === beat.id ? busy.doing : null;

  // Asking puts focus on the answer that loses nothing, and turning the
  // question down puts it back where it came from. Both are done by hand: a
  // browser that does not focus a button when it is clicked, as Safari does
  // not, would otherwise leave focus behind on the modal.
  useEffect(() => {
    if (confirming) keepButton.current?.focus();
    else if (wasConfirming.current) deleteButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  return (
    <li className="sb-beat" data-testid="beat" aria-current={current ? 'true' : undefined}>
      <div className="sb-beat-what">
        <span className="sb-beat-name" data-testid="beat-name-saved">
          {beat.name}
        </span>
        <span className="sb-beat-when">
          Saved <When at={beat.updatedAt} /> · {formatKilobytes(beat.bytes)}
        </span>
      </div>
      {confirming ? (
        <div key="question" className="sb-beat-actions" role="group" aria-label={`Delete ${beat.name}?`}>
          <span className="sb-beat-ask">Delete it for good?</span>
          <button
            ref={keepButton}
            className="sb-button"
            type="button"
            data-testid="beat-delete-cancel"
            onClick={() => setConfirming(false)}
          >
            Keep it
          </button>
          <button
            className="sb-button sb-button-danger"
            type="button"
            data-testid="beat-delete-confirm"
            onClick={() => {
              setConfirming(false);
              onDelete();
            }}
          >
            Delete it
          </button>
        </div>
      ) : (
        <div key="actions" className="sb-beat-actions">
          <button
            className="sb-button"
            type="button"
            data-testid="beat-load"
            aria-label={`Load ${beat.name} onto the machine`}
            disabled={busy !== null}
            onClick={onLoad}
          >
            {mine === 'loading' ? 'Loading…' : 'Load'}
          </button>
          <button
            ref={deleteButton}
            className="sb-button sb-button-danger"
            type="button"
            data-testid="beat-delete"
            aria-label={`Delete ${beat.name} from your account`}
            disabled={busy !== null}
            onClick={() => setConfirming(true)}
          >
            {mine === 'deleting' ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
    </li>
  );
}

interface SavedBeatsProps {
  /** Base URL the site is served from, ending in a slash. */
  baseUrl: string;
  /** The account's public id. What this device remembers is kept per account. */
  account: string;
  /** Closes the modal, so a loaded beat is seen on the machine. */
  close(): void;
}

function MachineBeats({ baseUrl, account, close, runtime }: SavedBeatsProps & { runtime: EditorRuntime }) {
  const projectId = useEditorState((state) => state.project.id);
  const projectName = useEditorState((state) => state.project.name);
  const [list, setList] = useState<Loaded>({ state: 'loading' });
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  const links = deviceBeatLinks();

  const show = (asked: Asked<{ beats: BeatSummary[]; limit: number }>) => {
    if (!asked.ok) {
      setList({ state: 'failed', problem: explain(asked.failure) });
      return;
    }
    links.keepOnly(
      account,
      asked.answer.beats.map((beat) => beat.id),
    );
    setList({ state: 'ready', beats: asked.answer.beats, limit: asked.answer.limit });
  };
  const refresh = async () => show(await listBeats(baseUrl));

  useEffect(() => {
    let wanted = true;
    void listBeats(baseUrl).then((asked) => {
      if (wanted) show(asked);
    });
    return () => {
      wanted = false;
    };
    // `show` only reads what these two decide.
  }, [baseUrl, account]);

  const begin = (next: Busy) => {
    setBusy(next);
    setProblem(null);
    setSaid('');
    setConflict(null);
  };

  /** Saves what is on the machine: over `into`, or as a new beat when there is none. */
  const save = async (into: BeatSummary | null, overwrite = false) => {
    const { project } = runtime.store.getState();
    const lastSeen = into ? links.get(account, project.id)?.seen : undefined;
    begin({ doing: 'saving' });
    const asked =
      into && lastSeen
        ? await replaceBeat(baseUrl, into.id, project, lastSeen, overwrite)
        : await saveNewBeat(baseUrl, project);
    setBusy(null);

    if (asked.ok) {
      const { beat } = asked.answer;
      links.set(account, project.id, { beat: beat.id, seen: beat.updatedAt });
      setList((now) =>
        now.state === 'ready' ? { ...now, beats: [beat, ...now.beats.filter((other) => other.id !== beat.id)] } : now,
      );
      setSaid(`Saved “${beat.name}” to your account.`);
      return;
    }
    const { failure } = asked;
    if (failure.code === 'conflict' && into && failure.updatedAt) {
      setConflict({ beat: into, updatedAt: failure.updatedAt });
      void refresh();
    } else if (failure.code === 'not_found') {
      await refresh();
      setProblem('That beat is no longer in your account, so there was nothing to replace. Save again to keep this one.');
    } else {
      setProblem(explain(failure));
    }
  };

  const load = async (beat: BeatSummary) => {
    begin({ doing: 'loading', beat: beat.id });
    const asked = await fetchBeat(baseUrl, beat.id);
    setBusy(null);
    if (!asked.ok) {
      setProblem(explain(asked.failure));
      if (asked.failure.code === 'not_found') void refresh();
      return;
    }
    const loaded = runtime.loadSavedBeat(asked.answer.project);
    if (!loaded) {
      setProblem('That saved beat could not be read, so I left the machine as it was.');
      return;
    }
    // A beat taken over from another machine is a new one. Saving it adds a beat; the one loaded stays.
    if (!loaded.adopted) {
      links.set(account, loaded.project.id, { beat: asked.answer.beat.id, seen: asked.answer.beat.updatedAt });
    }
    close();
  };

  const remove = async (beat: BeatSummary) => {
    begin({ doing: 'deleting', beat: beat.id });
    const asked = await deleteBeat(baseUrl, beat.id);
    setBusy(null);
    if (!asked.ok && asked.failure.code !== 'not_found') {
      setProblem(explain(asked.failure));
      return;
    }
    setList((now) => (now.state === 'ready' ? { ...now, beats: now.beats.filter((other) => other.id !== beat.id) } : now));
    setSaid(`Deleted “${beat.name}” from your account.`);
    saveButton.current?.focus();
  };

  const ready = list.state === 'ready' ? list : null;
  const link = links.get(account, projectId);
  const target = (link && ready?.beats.find((beat) => beat.id === link.beat)) || null;
  const full = ready !== null && beatLimitReached(ready.beats.length, ready.limit);
  const saving = busy?.doing === 'saving';
  // The list is fetched again when a save is held back, so the question uses the name as it is now.
  const newer = conflict && (ready?.beats.find((beat) => beat.id === conflict.beat.id) ?? conflict.beat);

  return (
    <section className="sb-beats" data-testid="beats" aria-labelledby={`${questionId}-title`}>
      <div className="sb-beats-head">
        <h3 className="sb-label" id={`${questionId}-title`}>
          Saved beats
        </h3>
        {ready && (
          <span className="sb-beats-count" data-testid="beats-count">
            {ready.beats.length} of {ready.limit}
          </span>
        )}
      </div>

      <div className="sb-form">
        <button
          ref={saveButton}
          className="sb-button sb-button-primary"
          type="button"
          data-testid="beats-save"
          disabled={!ready || busy !== null || (full && !target)}
          onClick={() => void save(target)}
        >
          {saving ? 'Saving…' : 'Save this beat to my account'}
        </button>
        {ready && (
          <p className="sb-hint" data-testid="beats-save-hint">
            {target ? (
              <>
                This replaces “{target.name}”, saved <When at={target.updatedAt} />.{' '}
                {!full && (
                  <button
                    className="sb-link"
                    type="button"
                    data-testid="beats-save-new"
                    disabled={busy !== null}
                    onClick={() => void save(null)}
                  >
                    Save it as a new beat instead
                  </button>
                )}
              </>
            ) : full ? (
              `Your account is full: it holds ${ready.limit} beats. Delete one to save another.`
            ) : (
              `This puts a copy of “${projectName}” in your account. The machine keeps working from this browser.`
            )}
          </p>
        )}
        {conflict && newer && (
          <div
            className="sb-notice sb-beats-question"
            data-kind="error"
            data-testid="beats-conflict"
            role="group"
            aria-labelledby={questionId}
          >
            <div className="sb-notice-body">
              <p id={questionId}>
                “{newer.name}” in your account was saved <When at={conflict.updatedAt} />, after the copy this
                device last had. Replace it with what is on the machine?
              </p>
              <div className="sb-beats-choices">
                <button
                  className="sb-button"
                  type="button"
                  data-testid="beats-keep-cloud"
                  autoFocus
                  onClick={() => {
                    setConflict(null);
                    setSaid('I left the copy in your account as it is. Load it to work from that one.');
                    saveButton.current?.focus();
                  }}
                >
                  Keep the cloud copy
                </button>
                <button
                  className="sb-button sb-button-danger"
                  type="button"
                  data-testid="beats-replace"
                  onClick={() => void save(conflict.beat, true)}
                >
                  Replace it
                </button>
              </div>
            </div>
          </div>
        )}
        <p className="sb-form-problem" role="alert" data-testid="beats-problem">
          {problem}
        </p>
        <p className="sb-hint sb-beats-said" role="status" data-testid="beats-said">
          {said}
        </p>
      </div>

      {list.state === 'loading' && (
        <p className="sb-modal-text" role="status" data-testid="beats-loading">
          Fetching your saved beats…
        </p>
      )}
      {list.state === 'failed' && (
        <div className="sb-form" data-testid="beats-failed">
          <p className="sb-form-problem" role="alert">
            {list.problem}
          </p>
          <button
            className="sb-button"
            type="button"
            data-testid="beats-retry"
            onClick={() => {
              setList({ state: 'loading' });
              void refresh();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {ready && ready.beats.length === 0 && (
        <p className="sb-modal-text sb-beats-empty" data-testid="beats-empty">
          Nothing saved yet. The beat on the machine is still kept in this browser, as before.
        </p>
      )}
      {ready && ready.beats.length > 0 && (
        <ul className="sb-beat-list" data-testid="beat-list">
          {ready.beats.map((beat) => (
            <BeatRow
              key={beat.id}
              beat={beat}
              current={beat.id === target?.id}
              busy={busy}
              onLoad={() => void load(beat)}
              onDelete={() => void remove(beat)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The beats saved to the account that is logged in: save what is on the
 * machine, and load or delete what is there. Nothing here runs until the
 * account modal is open, and the machine never waits on any of it.
 */
export function SavedBeats(props: SavedBeatsProps) {
  const runtime = useContext(RuntimeContext);
  if (runtime) return <MachineBeats {...props} runtime={runtime} />;
  return (
    <section className="sb-beats" data-testid="beats-elsewhere">
      <p className="sb-modal-text">
        Saving and loading beats happens beside the machine.{' '}
        <a className="sb-link" href={props.baseUrl}>
          Go to the machine
        </a>
      </p>
    </section>
  );
}

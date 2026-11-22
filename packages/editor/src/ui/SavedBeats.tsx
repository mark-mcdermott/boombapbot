import { MAX_BEAT_NAME_LENGTH, beatLimitReached, formatKilobytes, type BeatSummary } from '@boombapbot/contracts';
import { Save } from 'lucide-react';
import { useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { deviceBeatLinks } from '../account/beat-links';
import {
  defaultBeatName,
  deleteBeat,
  fetchBeat,
  listBeats,
  renameBeat,
  replaceBeat,
  saveNewBeat,
  type Asked,
} from '../account/beats';
import { draftKeeper, draftKeptWhere, explain } from '../account/client';
import type { EditorRuntime } from '../runtime';
import { RuntimeContext, useEditorState } from './context';

type Loaded =
  | { state: 'loading' }
  | { state: 'failed'; problem: string }
  | { state: 'ready'; beats: BeatSummary[]; limit: number };

/** The one call to the server that is under way, and the beat it is about. */
type Busy = { doing: 'saving' } | { doing: 'loading' | 'renaming' | 'deleting'; beat: string } | null;

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
  /** Answers whether the beat has its new name, so the row knows to stop asking for one. */
  onRename(name: string): Promise<boolean>;
  onDelete(): void;
}

/** What a row is showing in place of its buttons, if anything. */
type Asking = 'name' | 'delete' | null;

function BeatRow({ beat, current, busy, onLoad, onRename, onDelete }: BeatRowProps) {
  const [asking, setAsking] = useState<Asking>(null);
  const [draft, setDraft] = useState(beat.name);
  const nameField = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef<Asking>(null);
  const mine = busy && 'beat' in busy && busy.beat === beat.id ? busy.doing : null;
  const wanted = draft.trim();

  // Asking puts focus where the answer goes: on the name, or on the answer
  // that loses nothing. Leaving a question puts it back on the button that
  // raised it. Both are done by hand: a browser that does not focus a button
  // when it is clicked, as Safari does not, would otherwise leave focus
  // behind on the modal.
  useEffect(() => {
    if (asking === 'name') nameField.current?.select();
    else if (asking === 'delete') keepButton.current?.focus();
    else if (wasAsking.current === 'name') editButton.current?.focus();
    else if (wasAsking.current === 'delete') deleteButton.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  const rename = async () => {
    if (!wanted || wanted === beat.name) {
      setAsking(null);
      return;
    }
    if (await onRename(wanted)) setAsking(null);
  };

  return (
    <li className="sb-beat" data-testid="beat" aria-current={current ? 'true' : undefined}>
      <div className="sb-beat-what">
        {asking === 'name' ? (
          <input
            ref={nameField}
            className="sb-input sb-beat-rename"
            data-testid="beat-rename-name"
            aria-label={`New name for ${beat.name}`}
            value={draft}
            maxLength={MAX_BEAT_NAME_LENGTH}
            spellCheck={false}
            autoComplete="off"
            disabled={mine === 'renaming'}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void rename();
              if (event.key === 'Escape') {
                // Drop the edit, and keep the key from also closing the modal.
                event.stopPropagation();
                setAsking(null);
              }
            }}
          />
        ) : (
          <span className="sb-beat-name" data-testid="beat-name-saved">
            {beat.name}
          </span>
        )}
        <span className="sb-beat-when">
          Saved <When at={beat.updatedAt} /> · {formatKilobytes(beat.bytes)}
        </span>
      </div>
      {asking === 'delete' && (
        <div key="question" className="sb-beat-actions" role="group" aria-label={`Delete ${beat.name}?`}>
          <span className="sb-beat-ask">Delete it for good?</span>
          <button
            ref={keepButton}
            className="sb-button"
            type="button"
            data-testid="beat-delete-cancel"
            onClick={() => setAsking(null)}
          >
            Keep it
          </button>
          <button
            className="sb-button sb-button-danger"
            type="button"
            data-testid="beat-delete-confirm"
            onClick={() => {
              setAsking(null);
              onDelete();
            }}
          >
            Delete it
          </button>
        </div>
      )}
      {asking === 'name' && (
        <div key="name" className="sb-beat-actions">
          <button
            className="sb-button sb-button-primary"
            type="button"
            data-testid="beat-rename-save"
            disabled={!wanted || mine === 'renaming'}
            onClick={() => void rename()}
          >
            {mine === 'renaming' ? 'Saving…' : 'Save'}
          </button>
          <button
            className="sb-button"
            type="button"
            data-testid="beat-rename-cancel"
            disabled={mine === 'renaming'}
            onClick={() => setAsking(null)}
          >
            Cancel
          </button>
        </div>
      )}
      {asking === null && (
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
            ref={editButton}
            className="sb-button"
            type="button"
            data-testid="beat-edit"
            aria-label={`Edit the name of ${beat.name}`}
            disabled={busy !== null}
            onClick={() => {
              setDraft(beat.name);
              setAsking('name');
            }}
          >
            Edit
          </button>
          <button
            ref={deleteButton}
            className="sb-button sb-button-danger"
            type="button"
            data-testid="beat-delete"
            aria-label={`Delete ${beat.name} from your account`}
            disabled={busy !== null}
            onClick={() => setAsking('delete')}
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
  // What the machine calls a beat nobody has named, which says nothing about the beat.
  const starterName = useMemo(
    () => runtime.machine.document.create({ id: projectId, now: new Date() }).name,
    [runtime],
  );
  const [list, setList] = useState<Loaded>({ state: 'loading' });
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [name, setName] = useState('');
  const [unnamed, setUnnamed] = useState(() => defaultBeatName(new Date()));
  const saveButton = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  const links = deviceBeatLinks();
  const linked = links.get(account, projectId)?.beat;

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
    runtime.store.setName(name.trim() || unnamed);
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
      setName(beat.name);
      setUnnamed(defaultBeatName(new Date()));
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

  const rename = async (beat: BeatSummary, to: string): Promise<boolean> => {
    begin({ doing: 'renaming', beat: beat.id });
    const asked = await renameBeat(baseUrl, beat.id, to);
    setBusy(null);
    if (!asked.ok) {
      const { failure } = asked;
      setProblem(
        failure.code === 'conflict' ? 'That beat was saved again just now. Give it the name once more.' : explain(failure),
      );
      if (failure.code === 'conflict' || failure.code === 'not_found') void refresh();
      return false;
    }
    const renamed = asked.answer.beat;
    setList((now) =>
      now.state === 'ready'
        ? { ...now, beats: now.beats.map((other) => (other.id === renamed.id ? renamed : other)) }
        : now,
    );
    // The beat on the machine carries the same name, or its next save would put the old one back.
    if (renamed.id === linked) {
      runtime.store.setName(renamed.name);
      setName(renamed.name);
    }
    setSaid(`Renamed “${beat.name}” to “${renamed.name}”.`);
    return true;
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
  const target = ready?.beats.find((beat) => beat.id === linked) ?? null;
  const targetId = target?.id;

  // The name offered is the one the beat on the machine is saved under, or
  // the one it was given, and none for a beat nobody has named. It follows
  // which beat that is, not the list, so a name being typed is not written
  // over when the list is fetched again.
  useEffect(
    () => setName(target?.name ?? (projectName === starterName ? '' : projectName)),
    [targetId, projectId],
  );
  const full = ready !== null && beatLimitReached(ready.beats.length, ready.limit);
  const saving = busy?.doing === 'saving';
  // The list is fetched again when a save is held back, so the question uses the name as it is now.
  const newer = conflict && (ready?.beats.find((beat) => beat.id === conflict.beat.id) ?? conflict.beat);

  return (
    <section className="sb-beats" data-testid="beats" aria-labelledby={`${questionId}-title`}>
      <div className="sb-beats-head">
        <h3 className="sb-account-heading" id={`${questionId}-title`}>
          My Beats
        </h3>
        {ready && (
          <span className="sb-beats-count" data-testid="beats-count">
            {ready.beats.length} of {ready.limit}
          </span>
        )}
      </div>

      <form
        className="sb-form"
        data-testid="beats-save-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void save(target);
        }}
      >
        <div className="sb-field">
          <label className="sb-label" htmlFor={`${questionId}-name`}>
            Name
          </label>
          <div className="sb-beats-save">
            <input
              id={`${questionId}-name`}
              className="sb-input"
              data-testid="beats-save-name"
              value={name}
              placeholder={unnamed}
              maxLength={MAX_BEAT_NAME_LENGTH}
              spellCheck={false}
              autoComplete="off"
              aria-describedby={`${questionId}-hint`}
              onChange={(event) => setName(event.target.value)}
            />
            <button
              ref={saveButton}
              className="sb-button sb-button-primary"
              type="submit"
              data-testid="beats-save"
              disabled={!ready || busy !== null || (full && !target)}
            >
              <Save aria-hidden="true" />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {ready && (
          <p className="sb-hint" id={`${questionId}-hint`} data-testid="beats-save-hint">
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
              `This puts a copy of the beat on the machine in your account. The machine keeps working from ${draftKeeper()}.`
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
      </form>

      {list.state === 'loading' && (
        <p className="sb-modal-text" role="status" data-testid="beats-loading">
          Fetching your beats…
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
          Nothing saved yet. The beat on the machine is still kept {draftKeptWhere()}, as before.
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
              onRename={(to) => rename(beat, to)}
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

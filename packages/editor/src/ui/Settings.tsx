import { Menu } from '@base-ui/react/menu';
import { Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { PROJECT_FILE_EXTENSION } from '@boombapbot/contracts';
import { useEditorState, useRuntime } from './context';
import { PanelNotes } from './HardwarePanel';
import { ChevronIcon, DownloadIcon, UploadIcon } from './icons';
import { Modal } from './Modal';
import { PatternActions, StatusBar } from './StatusBar';

const NAME_FIELD_ID = 'sb-beat-name';

function NameField() {
  const { store } = useRuntime();
  const name = useEditorState((state) => state.project.name);
  const [draft, setDraft] = useState(name);
  const reverting = useRef(false);
  useEffect(() => setDraft(name), [name]);
  return (
    <input
      id={NAME_FIELD_ID}
      className="sb-name"
      data-testid="beat-name"
      value={draft}
      maxLength={80}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (reverting.current) {
          reverting.current = false;
          setDraft(name);
          return;
        }
        store.setName(draft);
        setDraft(store.getState().project.name);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          // Drop the edit, and keep the key from also closing the modal.
          event.stopPropagation();
          reverting.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function ExportMenu() {
  const runtime = useRuntime();
  return (
    <Menu.Root>
      <Menu.Trigger className="sb-button" data-testid="export-menu">
        <DownloadIcon />
        <span>Export</span>
        <ChevronIcon />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="sb-menu-positioner" sideOffset={6} align="end">
          <Menu.Popup className="sb-menu">
            <Menu.Item className="sb-menu-item" data-testid="export-wav" onClick={() => void runtime.exportWav(24)}>
              <span>WAV loop</span>
              <span className="sb-menu-note">24-bit stereo, one measure</span>
            </Menu.Item>
            <Menu.Item className="sb-menu-item" data-testid="export-wav-16" onClick={() => void runtime.exportWav(16)}>
              <span>WAV loop, 16-bit</span>
              <span className="sb-menu-note">Stereo, one measure</span>
            </Menu.Item>
            <Menu.Item className="sb-menu-item" data-testid="export-midi" onClick={() => void runtime.exportMidi()}>
              <span>MIDI file</span>
              <span className="sb-menu-note">Tempo and drum notes, channel 10</span>
            </Menu.Item>
            <Menu.Item className="sb-menu-item" data-testid="export-project" onClick={() => runtime.exportProject()}>
              <span>Project file</span>
              <span className="sb-menu-note">Editable JSON, reopens here</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Group({ label, labelFor, children }: { label?: string; labelFor?: string; children: ReactNode }) {
  return (
    <div className="sb-modal-group">
      {label && labelFor ? (
        <label className="sb-label" htmlFor={labelFor}>
          {label}
        </label>
      ) : label ? (
        <span className="sb-label">{label}</span>
      ) : null}
      {children}
    </div>
  );
}

interface SettingsProps {
  /** Where the modal mounts, so it inherits the editor's theme. */
  container: RefObject<HTMLElement | null>;
}

/** The cog, and the modal behind it that holds everything but the machine. */
export function Settings({ container }: SettingsProps) {
  const runtime = useRuntime();
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        className="sb-visually-hidden"
        data-testid="import-input"
        aria-label="Import project file"
        tabIndex={-1}
        accept={`${PROJECT_FILE_EXTENSION},.json,application/json`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so choosing the same file again still fires a change.
          event.target.value = '';
          if (!file) return;
          // The result is reported above the machine, so get out of its way.
          setOpen(false);
          void runtime.importProject(file, file.name);
        }}
      />
      <Modal
        label="Settings"
        title="Settings"
        testId="settings"
        className="sb-ico-settings"
        icon={<SettingsIcon />}
        container={container}
        open={open}
        onOpenChange={setOpen}
      >
        <Group label="Beat name" labelFor={NAME_FIELD_ID}>
          <NameField />
        </Group>
        <Group label="Rhythm">
          <PatternActions />
        </Group>
        <Group label="File">
          <div className="sb-actions">
            <button
              type="button"
              className="sb-button"
              data-testid="import"
              onClick={() => fileInput.current?.click()}
            >
              <UploadIcon />
              <span>Import</span>
            </button>
            <ExportMenu />
          </div>
        </Group>
        <Group>
          <PanelNotes />
        </Group>
        <Group>
          <StatusBar />
        </Group>
        <Group>
          <p className="sb-footnote">
            Keys: <kbd>Space</kbd> start or stop · arrows move between steps and turn knobs and switches ·{' '}
            <kbd>Enter</kbd> presses a step · <kbd>Esc</kbd> lets CLEAR up · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo
          </p>
          <p className="sb-hint">
            v0.1 preview. The drum sounds are synthesised from the knobs and tuned by ear; they are not
            recordings of any hardware. Your beat is saved only in this browser; export the project file to keep
            a copy.
          </p>
        </Group>
      </Modal>
    </>
  );
}

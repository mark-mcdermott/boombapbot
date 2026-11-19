import { Menu } from '@base-ui/react/menu';
import { Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { PROJECT_FILE_EXTENSION } from '@boombapbot/contracts';
import type { WavBitDepth } from '../engine/wav';
import { useEditorState, useRuntime } from './context';
import { closingNoteText } from './draft-words';
import { ChevronIcon, DownloadIcon, UploadIcon } from './icons';
import { Modal } from './Modal';
import { PatternActions, StatusBar } from './StatusBar';
import { WavExportChip } from './WavExportChip';
import { wavExportSaid, wavExportWait } from './wav-export-words';

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

const WAV_ITEMS: Array<{ bitDepth: WavBitDepth; testId: string; label: string; note: string }> = [
  { bitDepth: 24, testId: 'export-wav', label: 'WAV loop', note: '24-bit stereo, one measure' },
  { bitDepth: 16, testId: 'export-wav-16', label: 'WAV loop, 16-bit', note: 'Stereo, one measure' },
];

function ExportMenu() {
  const runtime = useRuntime();
  const wait = useEditorState((state) => wavExportWait(state.wavExport));
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
            {WAV_ITEMS.map(({ bitDepth, testId, label, note }) => (
              <Menu.Item
                key={testId}
                className="sb-menu-item"
                data-testid={testId}
                disabled={wait !== null}
                onClick={() => void runtime.exportWav(bitDepth)}
              >
                <span>{label}</span>
                <span className="sb-menu-note">{wait ?? note}</span>
              </Menu.Item>
            ))}
            <Menu.Item className="sb-menu-item" data-testid="export-midi" onClick={() => void runtime.exportMidi()}>
              <span>MIDI file</span>
              <span className="sb-menu-note">Tempo and drum notes, channel 10</span>
            </Menu.Item>
            <Menu.Item className="sb-menu-item" data-testid="export-project" onClick={() => void runtime.exportProject()}>
              <span>Project file</span>
              <span className="sb-menu-note">Editable JSON, reopens here</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Where a WAV export stands. A screen reader is told when one starts and how
 * it ends; the line on the sheet also counts the render up, which would be
 * too much to have read out.
 */
function WavExportStatus() {
  const wav = useEditorState((state) => state.wavExport);
  const said = wav ? wavExportSaid(wav) : '';
  return (
    <>
      <span className="sb-visually-hidden" role="status" data-testid="wav-export-said">
        {said}
      </span>
      {wav && (
        <div className="sb-status" aria-hidden="true">
          <span data-testid="wav-export-status" data-state={wav.state}>
            {said}
            {wav.state === 'rendering' ? ` ${Math.round(wav.progress * 100)}%` : ''}
          </span>
        </div>
      )}
    </>
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
  /** Whether the page has an account to save a beat to. */
  accounts: boolean;
}

/** The cog, and the modal behind it that holds everything but the machine. */
export function Settings({ container, accounts }: SettingsProps) {
  const runtime = useRuntime();
  const draftKept = useEditorState((state) => state.draftState === 'saved');
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => setHost(container.current), [container]);

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
        <Group label="Patterns">
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
          <WavExportStatus />
        </Group>
        <Group>
          <runtime.machine.Notes />
        </Group>
        <Group>
          <StatusBar accounts={accounts} />
        </Group>
        <Group>
          <p className="sb-footnote" data-testid="keys-help">{runtime.machine.keysHelp}</p>
          <p className="sb-hint">{closingNoteText({ accounts, kept: draftKept })}</p>
        </Group>
      </Modal>
      <WavExportChip host={host} sheetOpen={open} openSheet={() => setOpen(true)} />
    </>
  );
}

import { Menu } from '@base-ui/react/menu';
import { useEffect, useRef, useState } from 'react';
import { PROJECT_FILE_EXTENSION } from '@boombapbot/contracts';
import { Brand } from './Brand';
import { useEditorState, useRuntime } from './context';
import { ChevronIcon, DownloadIcon, UploadIcon } from './icons';
import { Segmented } from './Segmented';
import type { EditorMode } from '../state/store';

function NameField() {
  const { store } = useRuntime();
  const name = useEditorState((state) => state.project.name);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  return (
    <input
      className="sb-name"
      data-testid="beat-name"
      aria-label="Beat name"
      value={draft}
      maxLength={80}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        store.setName(draft);
        setDraft(store.getState().project.name);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(name);
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
              <span className="sb-menu-note">24-bit stereo, one bar</span>
            </Menu.Item>
            <Menu.Item className="sb-menu-item" data-testid="export-wav-16" onClick={() => void runtime.exportWav(16)}>
              <span>WAV loop, 16-bit</span>
              <span className="sb-menu-note">Stereo, one bar</span>
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

export function Header() {
  const runtime = useRuntime();
  const mode = useEditorState((state) => state.mode);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <header className="sb-header">
      <Brand />
      <NameField />
      <div className="sb-header-actions">
        <Segmented<EditorMode>
          label="Editor"
          value={mode}
          onChange={(value) => runtime.store.setMode(value)}
          options={[
            { value: 'modern', label: 'Modern', testId: 'mode-modern' },
            { value: 'hardware', label: 'Hardware', testId: 'mode-hardware' },
          ]}
        />
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
            if (file) void runtime.importProject(file, file.name);
          }}
        />
        <button type="button" className="sb-button" data-testid="import" onClick={() => fileInput.current?.click()}>
          <UploadIcon />
          <span>Import</span>
        </button>
        <ExportMenu />
      </div>
    </header>
  );
}

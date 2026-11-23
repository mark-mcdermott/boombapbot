import type { Machine } from '@boombapbot/editor';
import { documentRitm12, type Project } from './document';
import { engineSetup, exportPlan } from './engine';
import { RESTING, SessionRitm12, memoryOf, type TransientRitm12 } from './session';
import { setDeskLamp, useDeskLamp } from './ui/desk-lamp';
import { holdsUpgrade } from './upgrade';
import { Panel } from './ui/Panel';
import { KeysHelp, Notes, Options, SettingsActions, StatusLines } from './ui/SettingsParts';
import './styles.css';

export * from './engine';
export * from './session';

export const machineRitm12: Machine<Project, TransientRitm12, SessionRitm12> = {
  id: 'ritm12',
  document: documentRitm12,
  memory: memoryOf,
  transient: RESTING,
  bpm: (project) => project.tempo,
  setup: (project) => engineSetup(project, { upgraded: holdsUpgrade() }),
  exportPlan,
  session: (host) => new SessionRitm12(host),
  Panel,
  SettingsActions,
  StatusLines,
  Notes,
  Options,
  light: {
    use: () => (useDeskLamp() === 'lit' ? 'light' : 'dark'),
    set: (next) => setDeskLamp(next === 'light' ? 'lit' : 'out'),
  },
  keysHelp: <KeysHelp />,
  messages: {
    earlierVersion: 'What changed on the way is listed here.',
    unreadableDraft:
      'Your saved draft could not be read, so a starter beat was loaded. The unreadable draft was set aside, not deleted.',
  },
};

/** The name a host imports, whichever machine its build is. */
export { machineRitm12 as machine };

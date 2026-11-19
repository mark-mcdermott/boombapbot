import { PROJECT_FORMAT, type DocumentKind, type ProjectBase } from '@boombapbot/contracts';
import type { EngineSetup } from '../src/engine';
import type { Machine, MachineSession } from '../src/machine';

/** A beat of the stand-in machine: a tempo, one row of kick hits and one knob. */
export interface TestProject extends ProjectBase {
  machine: 'test';
  tempo: number;
  /** A bit a step, as the engine holds a row. */
  kicks: number;
  /** The kick's tune knob, 0 to 1. */
  tune: number;
}

const documentKind: DocumentKind<TestProject> = {
  machine: 'test',
  draftKey: 'boombapbot.test.draft',
  earlierDraftKeys: [],
  owns: (header) => header.machine === 'test',
  parse: (input) => ({ ok: true, project: input as TestProject, changes: [] }),
  serialize: (project) => JSON.stringify(project),
  create: ({ id, now }) => ({
    format: PROJECT_FORMAT,
    schemaVersion: 1,
    machine: 'test',
    id,
    name: 'Test beat',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    tempo: 120,
    kicks: 0b0001_0001_0001_0001,
    tune: 0.5,
  }),
};

/** What the stand-in machine asks of the engine: two sounds on two tracks, one pattern round and round, an echo. */
export function testSetup(project: TestProject): EngineSetup {
  return {
    tempo: project.tempo,
    sounds: [
      { sound: 0, tune: project.tune, tone: 0.5, decay: 0.5, snappy: 0.5 },
      { sound: 1, tune: 0.5, tone: 0.5, decay: 0.5, snappy: 0.5 },
    ],
    tracks: [
      { track: 1, slot: 0, pan: 0, chokeGroup: 0, gain: 0.8 },
      { track: 2, slot: 1, pan: 0.1, chokeGroup: 0, gain: 0.6 },
    ],
    accent: { plain: 0.6, accented: 1 },
    master: 0.8,
    patterns: [
      {
        rows: [0, project.kicks, 0b0001_0000_0001_0000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        firstLength: 16,
        secondLength: 0,
        stepsPerBeat: 4,
        swing: 0,
      },
    ],
    effect: { kind: 'delay', wet: 0.25 },
    follow: { cue: 0 },
  };
}

/** A machine with no panel and no project of any real one, for testing the core alone. */
export const testMachine: Machine<TestProject, object, MachineSession<TestProject, object>> = {
  id: 'test',
  document: documentKind,
  memory: (project) => ({ kicks: project.kicks }),
  transient: {},
  bpm: (project) => project.tempo,
  setup: testSetup,
  exportPlan: () => ({ error: 'The stand-in machine exports nothing.' }),
  session: () => ({
    start: () => ({ song: [], loop: false }),
    stopped: () => undefined,
  }),
  Panel: () => null,
  SettingsActions: () => null,
  StatusLines: () => null,
  Notes: () => null,
  keysHelp: null,
  messages: { earlierVersion: '', unreadableDraft: '' },
};

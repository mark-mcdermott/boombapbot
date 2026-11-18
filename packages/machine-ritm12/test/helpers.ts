import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createProjectCodec } from '@boombapbot/contracts';
import { EditorStore, type KeyValueStorage, type MachineHost } from '@boombapbot/editor';
import { createProject, documentRitm12, type Project, type VoiceId } from '../src/document';
import { RESTING, SessionRitm12, memoryOf, type StoreRitm12, type TransientRitm12 } from '../src/session';

export const codec = createProjectCodec([documentRitm12]);

/** A beat from before РИТМ-12, as it was saved. */
export function earlier(version: 1 | 2): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/earlier-v${version}.project.json`, import.meta.url), 'utf8'));
}

export const fixturePath = fileURLToPath(new URL('../fixtures/four-patterns.project.json', import.meta.url));

/** The committed beat with something on every pattern and every setting away from its default. */
export function loadFixture(): Project {
  const result = codec.parseText(readFileSync(fixturePath, 'utf8'));
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.project;
}

/** Storage that lives for one test, and can be told to refuse writes. */
export class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded');
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

export function newProject(): Project {
  return createProject({ id: 'test-beat', now: new Date('2026-11-17T12:00:00.000Z'), name: 'Test beat' });
}

/** A host with no audio that notes every hit it is asked to play. */
export interface TestHost extends MachineHost<Project, TransientRitm12> {
  triggered: number[];
  /** Moves the clock a tap is placed by, as a fraction of a step past the last one reported. */
  stepStarted: number;
}

export function testHost(store: StoreRitm12): TestHost {
  const host: TestHost = {
    store,
    triggered: [],
    stepStarted: 0,
    ensureAudio: async () => true,
    audioRunning: () => true,
    trigger: (track) => {
      host.triggered.push(track);
    },
    armFill: () => undefined,
    stop: () => undefined,
    stepStartedAt: () => host.stepStarted,
  };
  return host;
}

/** A new РИТМ-12 with a clock that ticks a second at every reading, and dice that roll as told. */
export function makeMachine(project: Project = newProject(), random: () => number = () => 0.2) {
  let tick = 0;
  const store: StoreRitm12 = new EditorStore({
    project,
    memory: memoryOf,
    transient: RESTING,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, (tick += 1))),
  });
  const host = testHost(store);
  return { store, host, session: new SessionRitm12(host, random) };
}

export const row = (store: StoreRitm12, voice: VoiceId, pattern = store.getState().project.panel.pattern): string =>
  store.getState().project.patterns[pattern]!.steps[voice];

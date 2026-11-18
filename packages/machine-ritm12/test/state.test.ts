import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { beatBytes, beatTooLarge } from '@boombapbot/contracts';
import {
  UNREADABLE_DRAFT_KEY,
  exportBaseName,
  loadDraft,
  projectFileName,
  readProjectFile,
  saveDraft,
} from '@boombapbot/editor';
import { VOICE_IDS, countHits, documentRitm12, forEachVoice, parseProject, serializeProject, type Project } from '../src/document';
import { MemoryStorage, codec, fixturePath, loadFixture, makeMachine, newProject } from './helpers';

const DRAFT_KEY = documentRitm12.draftKey;

describe('the draft kept in the browser', () => {
  it('is saved and comes back as it was', () => {
    const storage = new MemoryStorage();
    expect(loadDraft(storage, documentRitm12, codec)).toEqual({ status: 'empty' });
    const { store, session } = makeMachine();
    session.pressVoice('clap');
    session.pressStep(3);
    session.setTempoKnob(0.8);
    session.setLevel('rim', 0.4);
    session.setVoiceKnob('tone', 0.25);
    expect(saveDraft(storage, documentRitm12, store.getState().project)).toEqual({ ok: true });

    const loaded = loadDraft(storage, documentRitm12, codec);
    if (loaded.status !== 'restored') throw new Error(loaded.status);
    expect(loaded.project).toEqual(store.getState().project);
    expect(loaded.changes).toEqual([]);
    expect(loaded.adopted).toBe(false);
  });

  it('is set aside, not deleted, when it cannot be read', () => {
    const storage = new MemoryStorage();
    const broken = serializeProject(loadFixture()).replace('"tempo": 96', '"tempo": "fast"');
    expect(broken).toContain('"fast"');
    storage.items.set(DRAFT_KEY, broken);
    expect(loadDraft(storage, documentRitm12, codec).status).toBe('unreadable');
    expect(storage.getItem(DRAFT_KEY)).toBeNull();
    expect(storage.getItem(UNREADABLE_DRAFT_KEY)).toBe(broken);
    // The next load starts clean.
    expect(loadDraft(storage, documentRitm12, codec)).toEqual({ status: 'empty' });
  });

  it('is unreadable when it was cut short', () => {
    const storage = new MemoryStorage();
    storage.items.set(DRAFT_KEY, serializeProject(loadFixture()).slice(0, 200));
    expect(loadDraft(storage, documentRitm12, codec).status).toBe('unreadable');
  });

  it('reports a save that failed without throwing', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(saveDraft(storage, documentRitm12, loadFixture()).ok).toBe(false);
  });
});

describe('a project file', () => {
  it('is read when it is valid', async () => {
    const result = await readProjectFile(new Blob([readFileSync(fixturePath)]), codec);
    expect(result).toMatchObject({ ok: true, changes: [] });
  });

  it('is refused when it is not, and the beat on the machine is left alone', async () => {
    const { store } = makeMachine();
    const before = store.getState().project;
    for (const contents of [
      '{ nope',
      '{"format":"boombapbot.project","schemaVersion":1}',
      '{"format":"boombapbot.project","schemaVersion":3,"machine":"ritm12"}',
      '{"format":"boombapbot.project","schemaVersion":4,"machine":"another"}',
      'RIFF....WAVE',
    ]) {
      const result = await readProjectFile(new Blob([contents]), codec);
      expect(result.ok, contents).toBe(false);
      if (result.ok) store.replaceProject(result.project);
    }
    expect(store.getState().project).toBe(before);
  });

  it('replaces the whole beat, and undo brings all of the old one back', async () => {
    const { store, session } = makeMachine();
    session.setVoiceKnob('decay', 0.1);
    store.setName('Mine');
    session.clearPattern();
    const mine = store.getState().project;
    const result = await readProjectFile(new Blob([readFileSync(fixturePath)]), codec);
    if (!result.ok) throw new Error(result.errors.join('; '));
    store.replaceProject(result.project);
    expect(store.getState().project).toMatchObject({ name: 'Four patterns fixture', tempo: 96, patterns: loadFixture().patterns });
    // Undo brings back the knobs and the name too, not only the patterns.
    store.undo();
    expect(store.getState().project.name).toBe('Mine');
    expect(store.getState().project.voices).toEqual(mine.voices);
    expect(countHits(store.getState().project.patterns[0]!)).toBe(0);
    store.redo();
    expect(store.getState().project.name).toBe('Four patterns fixture');
  });

  it('is named safely', () => {
    const project = { ...loadFixture(), name: '  My  Beat / v2: "final"  ' };
    expect(exportBaseName(project)).toBe('my-beat-v2-final');
    expect(projectFileName(project)).toBe('my-beat-v2-final.boombapbot.json');
    expect(exportBaseName({ ...project, name: '///' })).toBe('boombapbot-beat');
  });
});

describe('the size of a saved beat', () => {
  it('fits an account even when the machine holds all it can', () => {
    const base = newProject();
    const awkward = 0.12345678901234568;
    const everyStep = 'x'.repeat(16);
    const fullest: Project = {
      ...base,
      id: 'x'.repeat(64),
      name: '🥁'.repeat(40),
      swing: awkward,
      patterns: base.patterns.map(() => ({ steps: forEachVoice(() => everyStep), accents: everyStep })),
      mix: { volume: awkward, accent: awkward, levels: forEachVoice(() => awkward), mutes: forEachVoice(() => true) },
      voices: forEachVoice(() => ({ pitch: awkward, decay: awkward, tone: awkward })),
      effect: { kind: 'flanger', mix: awkward },
    };
    expect(VOICE_IDS).toHaveLength(8);
    expect(parseProject(fullest).ok).toBe(true);
    expect(beatTooLarge(beatBytes(fullest))).toBe(false);
  });
});

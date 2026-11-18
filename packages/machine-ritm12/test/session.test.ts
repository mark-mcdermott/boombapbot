import { describe, expect, it, vi } from 'vitest';
import { loadDraft } from '@boombapbot/editor';
import { countHits, documentRitm12, isEmptyPattern, voiceTrack } from '../src/document';
import { remembersAnything, shownRow } from '../src/session';
import { MemoryStorage, codec, earlier, makeMachine, newProject, row } from './helpers';

describe('the step keys', () => {
  it('put a hit of the selected voice on and take it off, each an undo step', () => {
    const { store, session } = makeMachine();
    session.pressVoice('tom');
    session.selectPattern(2);
    expect(session.pressStep(3)).toBe(true);
    expect(row(store, 'tom')).toBe('...x............');
    expect(session.pressStep(3)).toBe(false);
    expect(row(store, 'tom')).toBe('................');
    store.undo();
    expect(row(store, 'tom')).toBe('...x............');
    store.undo();
    expect(isEmptyPattern(store.getState().project.patterns[2]!)).toBe(true);
    expect(store.getState().canUndo).toBe(false);
  });

  it('write the pattern\'s accents when the write switch says so', () => {
    const { store, session } = makeMachine();
    session.selectPattern(3);
    session.setWriteMode('accents');
    expect(session.pressStep(5)).toBe(false);
    expect(store.getState().project.patterns[3]!.accents).toBe('.....x..........');
    expect(shownRow(store.getState().project)).toBe('.....x..........');
    expect(countHits(store.getState().project.patterns[3]!)).toBe(0);
  });

  it('do nothing past the end of a twelve-step measure', () => {
    const { store, session } = makeMachine();
    session.selectPattern(2);
    session.setSize(12);
    expect(session.pressStep(12)).toBe(false);
    expect(session.pressStep(11)).toBe(true);
    expect(row(store, 'kick')).toBe('...........x....');
    expect(store.getState().canUndo).toBe(true);
  });
});

describe('the buttons', () => {
  it('select an instrument and sound it', async () => {
    const { store, session, host } = makeMachine();
    session.pressVoice('rim');
    await Promise.resolve();
    expect(store.getState().project.panel.selected).toBe('rim');
    expect(host.triggered).toEqual([voiceTrack('rim')]);
    store.setPower(false);
    session.pressVoice('kick');
    await Promise.resolve();
    expect(store.getState().project.panel.selected).toBe('rim');
    expect(host.triggered).toHaveLength(1);
  });

  it('mute the selected instrument and let it back', () => {
    const { store, session } = makeMachine();
    session.pressVoice('snare');
    session.toggleMute();
    expect(store.getState().project.mix.mutes).toMatchObject({ snare: true, kick: false });
    session.toggleMute();
    expect(store.getState().project.mix.mutes.snare).toBe(false);
    expect(store.getState().canUndo).toBe(false);
  });

  it('roll a new row for the selected voice, likelier on the beat, as one undo step', () => {
    const rolls = [0.5, 0.2, 0.2, 0.2, 0.5, 0.1, 0.4, 0.1];
    let next = 0;
    const { store, session } = makeMachine(newProject(), () => rolls[next++ % rolls.length]!);
    session.selectPattern(2);
    session.pressVoice('perc');
    session.rollDice();
    // A roll of 0.5 lands only on a beat; 0.2 on an even step; 0.1 anywhere.
    expect(row(store, 'perc')).toBe('x.x.xx.xx.x.xx.x');
    store.undo();
    expect(row(store, 'perc')).toBe('................');
    session.setSize(12);
    session.rollDice();
    expect(row(store, 'perc').slice(12)).toBe('....');
  });

  it('clear a pattern, clear them all, and bring the starter patterns back', () => {
    const { store, session } = makeMachine();
    session.clearPattern();
    expect(isEmptyPattern(store.getState().project.patterns[0]!)).toBe(true);
    expect(remembersAnything(store.getState().project)).toBe(true);
    session.clearEverything();
    expect(remembersAnything(store.getState().project)).toBe(false);
    session.clearEverything();
    session.loadStarterPatterns();
    expect(store.getState().project.patterns).toEqual(newProject().patterns);
    store.undo();
    store.undo();
    store.undo();
    expect(store.getState().project.patterns).toEqual(newProject().patterns);
    expect(store.getState().canUndo).toBe(false);
  });

  it('choose the pattern, the size, the effect and what the step keys write', () => {
    const { store, session } = makeMachine();
    session.selectPattern(3);
    session.selectPattern(9);
    session.setSize(12);
    session.setEffect('chorus');
    session.setWriteMode('accents');
    expect(store.getState().project).toMatchObject({
      size: 12,
      effect: { kind: 'chorus' },
      panel: { pattern: 3, write: 'accents' },
    });
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('the knobs', () => {
  it('turn within their travel and are not undo steps', () => {
    const { store, session } = makeMachine();
    session.setTempoKnob(1);
    session.setSwing(0.4);
    session.setAccent(2);
    session.setVolume(-1);
    session.setLevel('open_hat', 0.3);
    session.setEffectMix(0.7);
    session.pressVoice('clap');
    session.setVoiceKnob('pitch', 0.9);
    session.setVoiceKnob('decay', 0.1);
    session.setVoiceKnob('tone', 5);
    const { project } = store.getState();
    expect(project).toMatchObject({ tempo: 300, swing: 0.4, effect: { mix: 0.7 } });
    expect(project.mix).toMatchObject({ accent: 1, volume: 0 });
    expect(project.mix.levels.open_hat).toBe(0.3);
    expect(project.voices.clap).toEqual({ pitch: 0.9, decay: 0.1, tone: 1 });
    expect(project.voices.kick).toEqual({ pitch: 0.5, decay: 0.5, tone: 0.5 });
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('recording', () => {
  function playing(step: number) {
    const machine = makeMachine();
    machine.session.selectPattern(2);
    machine.session.toggleRecording();
    machine.store.setPlaying(true);
    machine.store.setPosition(step, 2);
    return machine;
  }

  it('writes a tap on the step that is sounding, and sounds it', () => {
    const { store, session, host } = playing(4);
    vi.spyOn(performance, 'now').mockReturnValue(10);
    host.stepStarted = 0;
    session.pressVoice('snare');
    expect(host.triggered).toEqual([voiceTrack('snare')]);
    expect(row(store, 'snare')).toBe('....x...........');
    vi.restoreAllMocks();
  });

  it('writes a late tap on the next step, once that step has gone by', () => {
    const { store, session, host } = playing(15);
    // A sixteenth at 104 is about 144 ms; this tap is 120 ms into it.
    vi.spyOn(performance, 'now').mockReturnValue(120);
    host.stepStarted = 0;
    session.pressVoice('kick');
    expect(host.triggered).toEqual([voiceTrack('kick')]);
    expect(row(store, 'kick')).toBe('................');
    store.setPosition(0, 2);
    session.changed({ ...store.getState(), currentStep: 15 }, store.getState());
    expect(row(store, 'kick')).toBe('x...............');
    vi.restoreAllMocks();
  });

  it('stores the whole take as one undo step when the machine stops', () => {
    const { store, session, host } = playing(2);
    vi.spyOn(performance, 'now').mockReturnValue(5);
    host.stepStarted = 0;
    session.pressVoice('kick');
    store.setPosition(6, 2);
    session.pressVoice('snare');
    vi.spyOn(performance, 'now').mockReturnValue(140);
    session.pressVoice('rim');
    expect(store.getState().canUndo).toBe(false);
    session.stopped();
    expect(row(store, 'kick')).toBe('..x.............');
    expect(row(store, 'snare')).toBe('......x.........');
    expect(row(store, 'rim')).toBe('.......x........');
    expect(store.getState().canUndo).toBe(true);
    store.undo();
    expect(isEmptyPattern(store.getState().project.patterns[2]!)).toBe(true);
    expect(store.getState().canUndo).toBe(false);
    vi.restoreAllMocks();
  });

  it('only sounds a tap when it is not recording, or the machine is not playing', async () => {
    const { store, session, host } = makeMachine();
    session.selectPattern(2);
    session.toggleRecording();
    session.pressVoice('tom');
    await Promise.resolve();
    expect(host.triggered).toEqual([voiceTrack('tom')]);
    expect(isEmptyPattern(store.getState().project.patterns[2]!)).toBe(true);
    session.toggleRecording();
    expect(store.getState().transient.recording).toBe(false);
  });
});

describe('the draft', () => {
  it('takes over a draft left by the earlier machine, and leaves that draft where it was', () => {
    const storage = new MemoryStorage();
    const left = JSON.stringify(earlier(2));
    storage.setItem('boombapbot.draft.v2', left);
    const loaded = loadDraft(storage, documentRitm12, codec);
    if (loaded.status !== 'restored') throw new Error(loaded.status);
    expect(loaded.project.machine).toBe('ritm12');
    expect(loaded.adopted).toBe(true);
    expect(loaded.changes.length).toBeGreaterThan(1);
    expect(storage.getItem('boombapbot.draft.v2')).toBe(left);
    expect(storage.items.size).toBe(1);
  });

  it('leaves an earlier draft alone even when it cannot be read', () => {
    const storage = new MemoryStorage();
    storage.setItem('boombapbot.draft.v1', '{"format":"boombapbot.project","schemaVersion":1}');
    expect(loadDraft(storage, documentRitm12, codec).status).toBe('unreadable');
    expect(storage.items.size).toBe(1);
    expect(storage.getItem('boombapbot.draft.v1')).not.toBeNull();
  });
});

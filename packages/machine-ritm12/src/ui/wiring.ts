import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useAssetManifest } from '@boombapbot/editor';
import {
  EFFECT_KINDS,
  PATTERN_NAMES,
  STEPS,
  VOICES,
  bpmAtKnob,
  getVoice,
  isStepOn,
  tempoKnob,
  type EffectKind,
  type VoiceId,
} from '../document';
import { shownRow } from '../session';
import type { KeyWiring, KnobWiring, LampWiring } from './Controls';
import { useEditorState, useRuntime, type Readout } from './context';
import type { ScreenLine } from './Screen';

/** Each effect as it is lettered and as it is said. */
export const EFFECTS: Record<EffectKind, { shown: string; spoken: string }> = {
  delay: { shown: 'ДИЛЭЙ', spoken: 'Delay' },
  reverb: { shown: 'РЕВЕРБ', spoken: 'Reverb' },
  flanger: { shown: 'ФЛЭНЖЕР', spoken: 'Flanger' },
  chorus: { shown: 'ХОР', spoken: 'Chorus' },
};
/** How long a line a control put on the screen stays there, in milliseconds. */
const LINE_MS = 1400;

const percent = (value: number) => `${Math.round(value * 100)}%`;

export interface VoiceWiring {
  voice: VoiceId;
  key: KeyWiring;
  lamp: LampWiring;
  level: KnobWiring;
}

export type KnobName = 'tempo' | 'swing' | 'accent' | 'pitch' | 'decay' | 'tone' | 'mix' | 'volume';
export type KeyName = 'power' | 'play' | 'stop' | 'record' | 'mute' | 'dice' | 'clear' | 'write' | 'effect' | 'size';

/** Everything on the panel: what each control shows and does. A view only has to draw it. */
export interface Wiring {
  /** Goes on the element that holds the step keys, so the arrow keys can move between them. */
  frame: RefObject<HTMLDivElement | null>;
  readout: Readout;
  /** The line a control last put on the screen. */
  line: { current: ScreenLine };
  /** The same, in English, for a screen reader. */
  spoken: string;
  power: boolean;
  powerLamp: LampWiring;
  /** Where each stepped control stands. */
  write: 'hits' | 'accents';
  effect: EffectKind;
  size: number;
  selected: VoiceId;
  keys: Record<KeyName, KeyWiring>;
  voices: VoiceWiring[];
  steps: KeyWiring[];
  patterns: KeyWiring[];
  knobs: Record<KnobName, KnobWiring>;
  pressVoice(voice: VoiceId): void;
}

/**
 * The panel's wiring: the machine's state read once, and every control's
 * name, state and action made from it. Both views of the panel, the picture
 * and the phone's, draw from this, so a control cannot do one thing in one
 * and another in the other.
 */
export function useWiring(): Wiring {
  const runtime = useRuntime();
  const { session } = runtime;
  const manifest = useAssetManifest();
  const project = useEditorState((state) => state.project);
  const power = useEditorState((state) => state.power);
  const playing = useEditorState((state) => state.playing);
  const step = useEditorState((state) => state.currentStep);
  const playingPattern = useEditorState((state) => state.currentPattern);
  const recording = useEditorState((state) => state.transient.recording);
  const [spoken, setSpoken] = useState('');
  const [taps, setTaps] = useState<Partial<Record<VoiceId, number>>>({});
  const line = useRef<ScreenLine>({ text: '', until: 0 });
  const frame = useRef<HTMLDivElement>(null);

  const artBase = manifest?.art ?? null;
  const readout = useMemo<Readout>(
    () => ({
      say(onScreen, english) {
        line.current = { text: onScreen, until: performance.now() + LINE_MS };
        setSpoken(english);
      },
      art: (file) => (artBase ? runtime.assetUrl(`${artBase}${file}`) : null),
    }),
    [artBase, runtime],
  );

  const { panel, mix, effect, size } = project;
  const selected = getVoice(panel.selected);
  const knobs = project.voices[panel.selected];
  const accents = panel.write === 'accents';
  const row = shownRow(project);
  const sounding = playing && playingPattern >= 0 ? project.patterns[playingPattern] : undefined;
  // Chosen while another pattern plays: it takes over at the bar line.
  const waiting = playing && playingPattern >= 0 && playingPattern !== panel.pattern;
  const pattern = PATTERN_NAMES[panel.pattern];

  const focusStep = (index: number) =>
    frame.current?.querySelector<HTMLButtonElement>(`[data-step="${(index + STEPS) % STEPS}"]`)?.focus();
  const onStepKey = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowRight') focusStep(index + 1);
    else if (event.key === 'ArrowLeft') focusStep(index - 1);
    else return;
    event.preventDefault();
  };

  const pressVoice = (voice: VoiceId) => {
    session.pressVoice(voice);
    setTaps((counts) => ({ ...counts, [voice]: (counts[voice] ?? 0) + 1 }));
    readout.say(getVoice(voice).label, `${getVoice(voice).name} selected`);
  };

  const voices = VOICES.map((voice): VoiceWiring => {
    const muted = mix.mutes[voice.id];
    const hit = sounding && step >= 0 && !muted && isStepOn(sounding.steps[voice.id], step);
    return {
      voice: voice.id,
      key: {
        label: `${voice.name} (${voice.label})`,
        testId: `voice-${voice.id}`,
        pressed: voice.id === panel.selected,
        onPress: () => pressVoice(voice.id),
      },
      lamp: {
        glow: power && voice.id === panel.selected && !muted ? 0.42 : 0,
        hit: hit ? step : undefined,
        taps: taps[voice.id],
        testId: `lamp-${voice.id}`,
      },
      level: {
        label: `${voice.name} level`,
        testId: `level-${voice.id}`,
        value: mix.levels[voice.id],
        rest: 0.75,
        spoken: percent,
        shown: (value) => `${voice.label} УРОВЕНЬ ${percent(value)}`,
        onChange: (value) => session.setLevel(voice.id, value),
      },
    };
  });

  const steps = Array.from({ length: STEPS }, (_, index): KeyWiring => {
    const on = index < size && isStepOn(row, index);
    const what = accents ? 'Accent' : selected.name;
    return {
      label: `${what}, step ${index + 1}, ${index >= size ? 'not in this measure' : on ? 'on' : 'off'}`,
      testId: `step-${index + 1}`,
      pressed: on,
      lit: on,
      red: accents,
      now: step === index && !waiting,
      unused: index >= size,
      disabled: index >= size,
      data: { 'data-step': index },
      onKeyDown: onStepKey(index),
      onPress: () => {
        if (session.pressStep(index) && !playing) session.auditionIfRunning(panel.selected);
      },
    };
  });

  const patterns = PATTERN_NAMES.map(
    (name, index): KeyWiring => ({
      label: `Pattern ${name}`,
      testId: `pattern-${index + 1}`,
      pressed: index === panel.pattern,
      lit: index === panel.pattern,
      blink: waiting && index === panel.pattern,
      onPress: () => {
        session.selectPattern(index);
        readout.say(`ПАТТЕРН ${name}`, `Pattern ${name}`);
      },
    }),
  );

  const keys: Record<KeyName, KeyWiring> = {
    power: {
      label: 'Power (СЕТЬ)',
      testId: 'power',
      pressed: power,
      lit: power,
      data: { 'data-rocker': 'true' },
      onPress: () => runtime.setPower(!power),
    },
    play: { label: 'Play', testId: 'play', lit: playing, pressed: playing, onPress: () => void runtime.play() },
    stop: { label: 'Stop', testId: 'stop', onPress: () => runtime.stop() },
    record: {
      label: 'Record: tap instruments in time',
      testId: 'record',
      red: true,
      lit: recording,
      pressed: recording,
      onPress: () => {
        session.toggleRecording();
        if (!recording && !playing) void runtime.play();
        readout.say(recording ? 'ЗАПИСЬ ВЫКЛ' : '● ЗАПИСЬ', recording ? 'Recording off' : 'Recording');
      },
    },
    mute: {
      label: `Mute ${selected.name} (МУТ)`,
      testId: 'mute',
      lit: mix.mutes[selected.id],
      pressed: mix.mutes[selected.id],
      onPress: () => {
        session.toggleMute();
        const muted = !mix.mutes[selected.id];
        readout.say(`${selected.label} ${muted ? 'МУТ' : 'ЗВУК'}`, `${selected.name} ${muted ? 'muted' : 'sounding'}`);
      },
    },
    dice: {
      label: `Dice: a new row for ${selected.name}`,
      testId: 'dice',
      onPress: () => {
        session.rollDice();
        readout.say(`${selected.label} СЛУЧАЙНО`, `New row for ${selected.name}`);
      },
    },
    clear: {
      label: `Clear pattern ${pattern} (СБРОС)`,
      testId: 'clear-pattern',
      onPress: () => {
        session.clearPattern();
        readout.say(`ПАТТЕРН ${pattern} СБРОС`, `Pattern ${pattern} cleared`);
      },
    },
    write: {
      label: `Step keys write ${accents ? 'accents' : 'hits'}. Press for ${accents ? 'hits' : 'accents'}.`,
      testId: 'write',
      data: { 'data-position': panel.write },
      onPress: () => {
        session.setWriteMode(accents ? 'hits' : 'accents');
        readout.say(accents ? 'ЗАПИСЬ: УДАРЫ' : 'ЗАПИСЬ: АКЦЕНТЫ', accents ? 'Step keys write hits' : 'Step keys write accents');
      },
    },
    effect: {
      label: `Effect: ${EFFECTS[effect.kind].spoken}. Press for the next one.`,
      testId: 'effect',
      data: { 'data-position': effect.kind },
      onPress: () => {
        const next = EFFECT_KINDS[(EFFECT_KINDS.indexOf(effect.kind) + 1) % EFFECT_KINDS.length]!;
        session.setEffect(next);
        readout.say(`ЭФФЕКТ: ${EFFECTS[next].shown}`, `Effect: ${EFFECTS[next].spoken}`);
      },
    },
    size: {
      label: `Measure of ${size === 16 ? '16 steps' : '12 steps, triplets'}. Press for ${size === 16 ? '12, triplets' : '16'}.`,
      testId: 'size',
      data: { 'data-position': size },
      onPress: () => {
        session.setSize(size === 16 ? 12 : 16);
        readout.say(size === 16 ? 'РАЗМЕР 12 ТРИОЛИ' : 'РАЗМЕР 16 ПРЯМОЙ', size === 16 ? '12 steps, triplets' : '16 steps');
      },
    },
  };

  const voiceKnob = (knob: 'pitch' | 'decay' | 'tone', lettered: string): KnobWiring => ({
    label: `${selected.name} ${knob}`,
    testId: knob,
    value: knobs[knob],
    rest: 0.5,
    spoken: percent,
    shown: (value) => `${lettered} ${percent(value)}`,
    onChange: (value) => session.setVoiceKnob(knob, value),
  });

  return {
    frame,
    readout,
    line,
    spoken,
    power,
    powerLamp: { glow: power ? 0.9 : 0, testId: 'lamp-power' },
    write: panel.write,
    effect: effect.kind,
    size,
    selected: panel.selected,
    keys,
    voices,
    steps,
    patterns,
    knobs: {
      tempo: {
        label: 'Tempo',
        testId: 'tempo',
        value: tempoKnob(project.tempo),
        rest: tempoKnob(104),
        spoken: (value) => `${bpmAtKnob(value)} beats a minute`,
        shown: (value) => `ТЕМП ${bpmAtKnob(value)}`,
        onChange: (value) => session.setTempoKnob(value),
      },
      swing: {
        label: 'Swing',
        testId: 'swing',
        value: project.swing,
        rest: 0,
        spoken: (value) => `${Math.round(50 + value * 25)}%`,
        shown: (value) => `СВИНГ ${Math.round(50 + value * 25)}%`,
        onChange: (value) => session.setSwing(value),
      },
      accent: {
        label: 'Accent strength',
        testId: 'accent',
        value: mix.accent,
        rest: 0.6,
        spoken: percent,
        shown: (value) => `АКЦЕНТ ${percent(value)}`,
        onChange: (value) => session.setAccent(value),
      },
      pitch: voiceKnob('pitch', 'ПИТЧ'),
      decay: voiceKnob('decay', 'ЗАТУХАНИЕ'),
      tone: voiceKnob('tone', 'ТОН'),
      mix: {
        label: 'Effect mix',
        testId: 'mix',
        value: effect.mix,
        rest: 0,
        spoken: percent,
        shown: (value) => `СМЕСЬ ${percent(value)}`,
        onChange: (value) => session.setEffectMix(value),
      },
      volume: {
        label: 'Volume',
        testId: 'volume',
        value: mix.volume,
        rest: 0.8,
        spoken: percent,
        shown: (value) => `ГРОМКОСТЬ ${percent(value)}`,
        onChange: (value) => session.setVolume(value),
      },
    },
    pressVoice,
  };
}

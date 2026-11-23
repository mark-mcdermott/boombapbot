import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useAssetManifest } from '@boombapbot/editor';
import {
  reachableEffects,
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
import { holdsUpgrade } from '../upgrade';
import type { KeyWiring, KnobWiring, LampWiring } from './Controls';
import { useEditorState, useRuntime, type Readout } from './context';
import { LETTERING, useScript } from './lettering';
import type { ScreenLine } from './Screen';

/** Each effect as it is said. */
export const EFFECT_NAMES: Record<EffectKind, string> = {
  delay: 'Delay',
  reverb: 'Reverb',
  flanger: 'Flanger',
  chorus: 'Chorus',
  crusher: 'Crusher',
  tape: 'Tape',
  pump: 'Pump',
  filter: 'Filter',
  vinyl: 'Vinyl',
  phaser: 'Phaser',
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
  /** The same, in English: for a screen reader, and for whoever can see the lettering but not read it. */
  spoken: string;
  /** How many lines have been said. It moves on even when the same line is said again. */
  said: number;
  /** What the readout shows while no control has anything to say: where the machine stands, in English. */
  idle: string;
  power: boolean;
  powerLamp: LampWiring;
  /** Where each stepped control stands. */
  write: 'hits' | 'accents';
  effect: EffectKind;
  /** The effects the selector reaches, in its order. */
  effects: readonly EffectKind[];
  /** The beat's effect comes with the upgrade and this program does not hold it, so the beat plays without. */
  effectLeftOut: boolean;
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
  const [said, setSaid] = useState({ text: '', count: 0 });
  const [taps, setTaps] = useState<Partial<Record<VoiceId, number>>>({});
  const line = useRef<ScreenLine>({ text: '', until: 0 });
  const frame = useRef<HTMLDivElement>(null);
  const script = useScript();
  const words = LETTERING[script];
  /** A control's name says how it is lettered, while the lettering is not in English. */
  const lettered = (word: string) => (script === 'russian' ? ` (${word})` : '');

  const artBase = manifest?.art ?? null;
  const readout = useMemo<Readout>(
    () => ({
      say(onScreen, english) {
        line.current = { text: onScreen, until: performance.now() + LINE_MS };
        setSaid((now) => ({ text: english, count: now.count + 1 }));
      },
      art: (file) => (artBase ? runtime.assetUrl(`${artBase}${file}`) : null),
    }),
    [artBase, runtime],
  );

  const { panel, mix, effect, size } = project;
  const effects = reachableEffects(holdsUpgrade());
  const effectLeftOut = !effects.includes(effect.kind);
  const selected = getVoice(panel.selected);
  const knobs = project.voices[panel.selected];
  const accents = panel.write === 'accents';
  const row = shownRow(project);
  const sounding = playing && playingPattern >= 0 ? project.patterns[playingPattern] : undefined;
  // Chosen while another pattern plays: it takes over at the bar line.
  const waiting = playing && playingPattern >= 0 && playingPattern !== panel.pattern;
  const pattern = words.patterns[panel.pattern];

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
    readout.say(words.voices[voice].key, `${getVoice(voice).name} selected`);
  };

  const voices = VOICES.map((voice): VoiceWiring => {
    const muted = mix.mutes[voice.id];
    const hit = sounding && step >= 0 && !muted && isStepOn(sounding.steps[voice.id], step);
    return {
      voice: voice.id,
      key: {
        label: `${voice.name}${lettered(words.voices[voice.id].key)}`,
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
        shown: (value) => `${words.voices[voice.id].key} ${words.level} ${percent(value)}`,
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

  const patterns = words.patterns.map(
    (name, index): KeyWiring => ({
      label: `Pattern ${name}`,
      testId: `pattern-${index + 1}`,
      pressed: index === panel.pattern,
      lit: index === panel.pattern,
      blink: waiting && index === panel.pattern,
      onPress: () => {
        session.selectPattern(index);
        readout.say(`${words.pattern} ${name}`, `Pattern ${name}`);
      },
    }),
  );

  const keys: Record<KeyName, KeyWiring> = {
    power: {
      label: `Power${lettered(words.power)}`,
      testId: 'power',
      pressed: power,
      lit: power,
      data: { 'data-rocker': 'true' },
      onPress: () => {
        runtime.setPower(!power);
        readout.say(`${words.power} ${power ? words.off : words.on}`, power ? 'Power off' : 'Power on');
      },
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
        readout.say(recording ? `${words.recording} ${words.off}` : `● ${words.recording}`, recording ? 'Recording off' : 'Recording');
      },
    },
    mute: {
      label: `Mute ${selected.name}${lettered(words.mute)}`,
      testId: 'mute',
      lit: mix.mutes[selected.id],
      pressed: mix.mutes[selected.id],
      onPress: () => {
        session.toggleMute();
        const muted = !mix.mutes[selected.id];
        readout.say(`${words.voices[selected.id].key} ${muted ? words.mute : words.sounding}`, `${selected.name} ${muted ? 'muted' : 'sounding'}`);
      },
    },
    dice: {
      label: `Dice: a new row for ${selected.name}`,
      testId: 'dice',
      onPress: () => {
        session.rollDice();
        readout.say(`${words.voices[selected.id].key} ${words.random}`, `New row for ${selected.name}`);
      },
    },
    clear: {
      label: `Clear pattern ${pattern}${lettered(words.clear)}`,
      testId: 'clear-pattern',
      onPress: () => {
        session.clearPattern();
        readout.say(`${words.pattern} ${pattern} ${words.clear}`, `Pattern ${pattern} cleared`);
      },
    },
    write: {
      label: `Step keys write ${accents ? 'accents' : 'hits'}. Press for ${accents ? 'hits' : 'accents'}.`,
      testId: 'write',
      data: { 'data-position': panel.write },
      onPress: () => {
        session.setWriteMode(accents ? 'hits' : 'accents');
        readout.say(`${words.recording}: ${accents ? words.hits : words.accents}`, accents ? 'Step keys write hits' : 'Step keys write accents');
      },
    },
    effect: {
      label: effectLeftOut
        ? `Effect: ${EFFECT_NAMES[effect.kind]}, which comes with the upgrade and is not playing. Press for the next one.`
        : `Effect: ${EFFECT_NAMES[effect.kind]}. Press for the next one.`,
      testId: 'effect',
      data: { 'data-position': effect.kind },
      onPress: () => {
        // From an effect the selector does not reach, the next one is its first.
        const next = effects[(effects.indexOf(effect.kind) + 1) % effects.length]!;
        session.setEffect(next);
        readout.say(`${words.effect}: ${words.effects[next]}`, `Effect: ${EFFECT_NAMES[next]}`);
      },
    },
    size: {
      label: `Measure of ${size === 16 ? '16 steps' : '12 steps, triplets'}. Press for ${size === 16 ? '12, triplets' : '16'}.`,
      testId: 'size',
      data: { 'data-position': size },
      onPress: () => {
        session.setSize(size === 16 ? 12 : 16);
        readout.say(`${words.size} ${size === 16 ? `12 ${words.triplets}` : `16 ${words.straight}`}`, size === 16 ? '12 steps, triplets' : '16 steps');
      },
    },
  };

  const voiceKnob = (knob: 'pitch' | 'decay' | 'tone'): KnobWiring => ({
    label: `${selected.name} ${knob}`,
    testId: knob,
    value: knobs[knob],
    rest: 0.5,
    spoken: percent,
    shown: (value) => `${words[knob]} ${percent(value)}`,
    onChange: (value) => session.setVoiceKnob(knob, value),
  });

  return {
    frame,
    readout,
    line,
    spoken: said.text,
    said: said.count,
    idle: `PATTERN ${LETTERING.english.patterns[panel.pattern]}  ${LETTERING.english.voices[panel.selected].key}  ${project.tempo} BPM`,
    power,
    powerLamp: { glow: power ? 0.9 : 0, testId: 'lamp-power' },
    write: panel.write,
    effect: effect.kind,
    effects,
    effectLeftOut,
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
        shown: (value) => `${words.tempo} ${bpmAtKnob(value)}`,
        onChange: (value) => session.setTempoKnob(value),
      },
      swing: {
        label: 'Swing',
        testId: 'swing',
        value: project.swing,
        rest: 0,
        spoken: (value) => `${Math.round(50 + value * 25)}%`,
        shown: (value) => `${words.swing} ${Math.round(50 + value * 25)}%`,
        onChange: (value) => session.setSwing(value),
      },
      accent: {
        label: 'Accent strength',
        testId: 'accent',
        value: mix.accent,
        rest: 0.6,
        spoken: percent,
        shown: (value) => `${words.accent} ${percent(value)}`,
        onChange: (value) => session.setAccent(value),
      },
      pitch: voiceKnob('pitch'),
      decay: voiceKnob('decay'),
      tone: voiceKnob('tone'),
      mix: {
        label: 'Effect mix',
        testId: 'mix',
        value: effect.mix,
        rest: 0,
        spoken: percent,
        shown: (value) => `${words.mix} ${percent(value)}`,
        onChange: (value) => session.setEffectMix(value),
      },
      volume: {
        label: 'Volume',
        testId: 'volume',
        value: mix.volume,
        rest: 0.8,
        spoken: percent,
        shown: (value) => `${words.volume} ${percent(value)}`,
        onChange: (value) => session.setVolume(value),
      },
    },
    pressVoice,
  };
}

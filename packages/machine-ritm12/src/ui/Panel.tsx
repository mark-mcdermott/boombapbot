import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { Segmented, useAssetManifest } from '@boombapbot/editor';
import {
  EFFECT_KINDS,
  PATTERN_NAMES,
  STEPS,
  bpmAtKnob,
  getVoice,
  isStepOn,
  tempoKnob,
  type EffectKind,
  type VoiceId,
} from '../document';
import { shownRow } from '../session';
import { Key, Lamp, Patch, PointerKnob } from './Controls';
import { ReadoutContext, useEditorState, useRuntime, type Readout } from './context';
import {
  BUTTONS,
  EFFECT_PATCH,
  INSTRUMENTS,
  INSTRUMENT_LAMP,
  KNOBS,
  PATCHES,
  PATTERN_KEYS,
  PLATE,
  POWER_LAMP,
  STEP_KEYS,
  SWITCHES,
  type Rect,
} from './layout';
import { ScreenAndMeter, type ScreenLine } from './Screen';

const EFFECTS: Record<EffectKind, { shown: string; spoken: string }> = {
  delay: { shown: 'ДИЛЭЙ', spoken: 'Delay' },
  reverb: { shown: 'РЕВЕРБ', spoken: 'Reverb' },
  flanger: { shown: 'ФЛЭНЖЕР', spoken: 'Flanger' },
  chorus: { shown: 'ХОР', spoken: 'Chorus' },
};
/** How long a line a control put on the screen stays there, in milliseconds. */
const LINE_MS = 1400;

const percent = (value: number) => `${Math.round(value * 100)}%`;
const around = ({ x, y, r }: { x: number; y: number; r: number }): Rect => [x - r, y - r, x + r, y + r];

/** How much the stage, which is as large as the picture, is shrunk to fit its frame. */
function useStageScale(frame: RefObject<HTMLDivElement | null>): number {
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return undefined;
    const measure = () => setScale(node.clientWidth / PLATE.width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [frame]);
  return scale;
}

/** РИТМ-12's panel: the picture of the machine, with every control on it live. */
export function Panel() {
  const runtime = useRuntime();
  const { session } = runtime;
  const manifest = useAssetManifest();
  const project = useEditorState((state) => state.project);
  const power = useEditorState((state) => state.power);
  const playing = useEditorState((state) => state.playing);
  const step = useEditorState((state) => state.currentStep);
  const playingPattern = useEditorState((state) => state.currentPattern);
  const recording = useEditorState((state) => state.transient.recording);
  const [fit, setFit] = useState(false);
  const [spoken, setSpoken] = useState('');
  const [taps, setTaps] = useState<Partial<Record<VoiceId, number>>>({});
  const line = useRef<ScreenLine>({ text: '', until: 0 });
  const frame = useRef<HTMLDivElement>(null);
  const scale = useStageScale(frame);

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

  return (
    <ReadoutContext.Provider value={readout}>
      <section className="rt-machine" aria-label="РИТМ-12 drum machine" data-testid="machine">
        <div className="rt-scroll" data-fit={fit}>
          <div ref={frame} className="rt-frame" data-testid="panel" data-power={power ? 'on' : 'off'}>
            <div className="rt-stage" style={{ transform: `scale(${scale})` } as CSSProperties}>
              {artBase ? <img className="rt-plate" src={readout.art('plate.webp') ?? undefined} alt="" draggable={false} data-testid="plate" /> : null}
              <Patch rect={PATCHES.power} name="power-on" shown={power} />
              <Patch rect={PATCHES.write} name="write-accents" shown={accents} />
              <Patch rect={PATCHES.size} name="size-16" shown={size === 16} />
              {EFFECT_KINDS.map((kind) => {
                const name = EFFECT_PATCH[kind];
                return name ? <Patch key={kind} rect={PATCHES.effect} name={name} shown={effect.kind === kind} /> : null;
              })}

              <ScreenAndMeter line={line} />

              <Key
                rect={BUTTONS.power}
                label="Power (СЕТЬ)"
                testId="power"
                pressed={power}
                lit={power}
                data={{ 'data-rocker': 'true' }}
                onPress={() => runtime.setPower(!power)}
              />
              <Lamp {...POWER_LAMP} glow={power ? 0.9 : 0} testId="lamp-power" />

              {/* Everything but the power switch: dark and out of reach while the machine is off. */}
              <div className="rt-controls" inert={!power}>
                {INSTRUMENTS.map((instrument) => {
                  const voice = getVoice(instrument.voice);
                  const muted = mix.mutes[voice.id];
                  const hit = sounding && step >= 0 && !muted && isStepOn(sounding.steps[voice.id], step);
                  const middle = (instrument.button[1] + instrument.button[3]) / 2 - 1;
                  return (
                    <div key={voice.id} className="rt-group">
                      <Key
                        rect={instrument.button}
                        label={`${voice.name} (${voice.label})`}
                        testId={`voice-${voice.id}`}
                        pressed={voice.id === panel.selected}
                        onPress={() => pressVoice(voice.id)}
                      />
                      <Lamp
                        x={INSTRUMENT_LAMP.x}
                        y={middle}
                        r={INSTRUMENT_LAMP.r}
                        glow={power && voice.id === panel.selected && !muted ? 0.42 : 0}
                        hit={hit ? step : undefined}
                        taps={taps[voice.id]}
                        testId={`lamp-${voice.id}`}
                      />
                      <PointerKnob
                        place={instrument.knob}
                        label={`${voice.name} level`}
                        testId={`level-${voice.id}`}
                        value={mix.levels[voice.id]}
                        rest={0.75}
                        spoken={percent}
                        shown={(value) => `${voice.label} УРОВЕНЬ ${percent(value)}`}
                        onChange={(value) => session.setLevel(voice.id, value)}
                      />
                    </div>
                  );
                })}

                {STEP_KEYS.map((rect, index) => {
                  const on = index < size && isStepOn(row, index);
                  const what = accents ? 'Accent' : selected.name;
                  return (
                    <Key
                      key={index}
                      rect={rect}
                      label={`${what}, step ${index + 1}, ${index >= size ? 'not in this measure' : on ? 'on' : 'off'}`}
                      testId={`step-${index + 1}`}
                      pressed={on}
                      lit={on}
                      red={accents}
                      now={step === index && !waiting}
                      unused={index >= size}
                      disabled={index >= size}
                      data={{ 'data-step': index }}
                      onKeyDown={onStepKey(index)}
                      onPress={() => {
                        if (session.pressStep(index) && !playing) session.auditionIfRunning(panel.selected);
                      }}
                    />
                  );
                })}

                {PATTERN_KEYS.map((rect, index) => (
                  <Key
                    key={index}
                    rect={rect}
                    label={`Pattern ${PATTERN_NAMES[index]}`}
                    testId={`pattern-${index + 1}`}
                    pressed={index === panel.pattern}
                    lit={index === panel.pattern}
                    blink={waiting && index === panel.pattern}
                    onPress={() => {
                      session.selectPattern(index);
                      readout.say(`ПАТТЕРН ${PATTERN_NAMES[index]}`, `Pattern ${PATTERN_NAMES[index]}`);
                    }}
                  />
                ))}

                <Key rect={BUTTONS.play} label="Play" testId="play" lit={playing} pressed={playing} onPress={() => void runtime.play()} />
                <Key rect={BUTTONS.stop} label="Stop" testId="stop" onPress={() => runtime.stop()} />
                <Key
                  rect={BUTTONS.record}
                  label="Record: tap instruments in time"
                  testId="record"
                  red
                  lit={recording}
                  pressed={recording}
                  onPress={() => {
                    session.toggleRecording();
                    if (!recording && !playing) void runtime.play();
                    readout.say(recording ? 'ЗАПИСЬ ВЫКЛ' : '● ЗАПИСЬ', recording ? 'Recording off' : 'Recording');
                  }}
                />
                <Key
                  rect={BUTTONS.mute}
                  label={`Mute ${selected.name} (МУТ)`}
                  testId="mute"
                  lit={mix.mutes[selected.id]}
                  pressed={mix.mutes[selected.id]}
                  onPress={() => {
                    session.toggleMute();
                    const muted = !mix.mutes[selected.id];
                    readout.say(`${selected.label} ${muted ? 'МУТ' : 'ЗВУК'}`, `${selected.name} ${muted ? 'muted' : 'sounding'}`);
                  }}
                />
                <Key
                  rect={BUTTONS.dice}
                  label={`Dice: a new row for ${selected.name}`}
                  testId="dice"
                  onPress={() => {
                    session.rollDice();
                    readout.say(`${selected.label} СЛУЧАЙНО`, `New row for ${selected.name}`);
                  }}
                />
                <Key
                  rect={BUTTONS.clear}
                  label={`Clear pattern ${PATTERN_NAMES[panel.pattern]} (СБРОС)`}
                  testId="clear-pattern"
                  onPress={() => {
                    session.clearPattern();
                    readout.say(`ПАТТЕРН ${PATTERN_NAMES[panel.pattern]} СБРОС`, `Pattern ${PATTERN_NAMES[panel.pattern]} cleared`);
                  }}
                />

                <Key
                  rect={around(SWITCHES.write)}
                  round
                  label={`Step keys write ${accents ? 'accents' : 'hits'}. Press for ${accents ? 'hits' : 'accents'}.`}
                  testId="write"
                  data={{ 'data-position': panel.write }}
                  onPress={() => {
                    session.setWriteMode(accents ? 'hits' : 'accents');
                    readout.say(accents ? 'ЗАПИСЬ: УДАРЫ' : 'ЗАПИСЬ: АКЦЕНТЫ', accents ? 'Step keys write hits' : 'Step keys write accents');
                  }}
                />
                <Key
                  rect={around(SWITCHES.effect)}
                  round
                  label={`Effect: ${EFFECTS[effect.kind].spoken}. Press for the next one.`}
                  testId="effect"
                  data={{ 'data-position': effect.kind }}
                  onPress={() => {
                    const next = EFFECT_KINDS[(EFFECT_KINDS.indexOf(effect.kind) + 1) % EFFECT_KINDS.length]!;
                    session.setEffect(next);
                    readout.say(`ЭФФЕКТ: ${EFFECTS[next].shown}`, `Effect: ${EFFECTS[next].spoken}`);
                  }}
                />
                <Key
                  rect={around(SWITCHES.size)}
                  round
                  label={`Measure of ${size === 16 ? '16 steps' : '12 steps, triplets'}. Press for ${size === 16 ? '12, triplets' : '16'}.`}
                  testId="size"
                  data={{ 'data-position': size }}
                  onPress={() => {
                    session.setSize(size === 16 ? 12 : 16);
                    readout.say(size === 16 ? 'РАЗМЕР 12 ТРИОЛИ' : 'РАЗМЕР 16 ПРЯМОЙ', size === 16 ? '12 steps, triplets' : '16 steps');
                  }}
                />

                <PointerKnob
                  place={KNOBS.tempo}
                  label="Tempo"
                  testId="tempo"
                  value={tempoKnob(project.tempo)}
                  rest={tempoKnob(104)}
                  spoken={(value) => `${bpmAtKnob(value)} beats a minute`}
                  shown={(value) => `ТЕМП ${bpmAtKnob(value)}`}
                  onChange={(value) => session.setTempoKnob(value)}
                />
                <PointerKnob
                  place={KNOBS.swing}
                  label="Swing"
                  testId="swing"
                  value={project.swing}
                  rest={0}
                  spoken={(value) => `${Math.round(50 + value * 25)}%`}
                  shown={(value) => `СВИНГ ${Math.round(50 + value * 25)}%`}
                  onChange={(value) => session.setSwing(value)}
                />
                <PointerKnob
                  place={KNOBS.accent}
                  label="Accent strength"
                  testId="accent"
                  value={mix.accent}
                  rest={0.6}
                  spoken={percent}
                  shown={(value) => `АКЦЕНТ ${percent(value)}`}
                  onChange={(value) => session.setAccent(value)}
                />
                <PointerKnob
                  place={KNOBS.pitch}
                  label={`${selected.name} pitch`}
                  testId="pitch"
                  value={knobs.pitch}
                  rest={0.5}
                  spoken={percent}
                  shown={(value) => `ПИТЧ ${percent(value)}`}
                  onChange={(value) => session.setVoiceKnob('pitch', value)}
                />
                <PointerKnob
                  place={KNOBS.decay}
                  label={`${selected.name} decay`}
                  testId="decay"
                  value={knobs.decay}
                  rest={0.5}
                  spoken={percent}
                  shown={(value) => `ЗАТУХАНИЕ ${percent(value)}`}
                  onChange={(value) => session.setVoiceKnob('decay', value)}
                />
                <PointerKnob
                  place={KNOBS.tone}
                  label={`${selected.name} tone`}
                  testId="tone"
                  value={knobs.tone}
                  rest={0.5}
                  spoken={percent}
                  shown={(value) => `ТОН ${percent(value)}`}
                  onChange={(value) => session.setVoiceKnob('tone', value)}
                />
                <PointerKnob
                  place={KNOBS.mix}
                  label="Effect mix"
                  testId="mix"
                  value={effect.mix}
                  rest={0}
                  spoken={percent}
                  shown={(value) => `СМЕСЬ ${percent(value)}`}
                  onChange={(value) => session.setEffectMix(value)}
                />
                <PointerKnob
                  place={KNOBS.volume}
                  label="Volume"
                  testId="volume"
                  value={mix.volume}
                  rest={0.8}
                  spoken={percent}
                  shown={(value) => `ГРОМКОСТЬ ${percent(value)}`}
                  onChange={(value) => session.setVolume(value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* On a phone the picture's instrument buttons are too small to tap. */}
        <div className="rt-touch" inert={!power}>
          <Segmented
            label="Instrument"
            className="sb-segmented-fill rt-strip"
            value={panel.selected}
            onChange={pressVoice}
            options={INSTRUMENTS.map((instrument) => ({
              value: instrument.voice,
              label: instrument.short,
              name: getVoice(instrument.voice).name,
              testId: `strip-${instrument.voice}`,
            }))}
          />
          <button type="button" className="sb-button" aria-pressed={fit} data-testid="fit" onClick={() => setFit(!fit)}>
            {fit ? 'Zoom in' : 'Fit to screen'}
          </button>
        </div>

        <p className="sb-visually-hidden" aria-live="polite" data-testid="spoken">
          {spoken}
        </p>
      </section>
    </ReadoutContext.Provider>
  );
}

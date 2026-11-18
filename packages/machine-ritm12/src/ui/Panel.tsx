import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Segmented } from '@boombapbot/editor';
import { EFFECT_KINDS, getVoice } from '../document';
import { Key, Lamp, Patch, PointerKnob } from './Controls';
import { ReadoutContext } from './context';
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
import { PhonePanel } from './PhonePanel';
import { ScreenAndMeter } from './Screen';
import { useWiring, type KnobName } from './wiring';

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

/**
 * The phone's panel is a preview for now: a page opened with `?panel=phone`
 * in its address shows it, at any width. Every other page shows the picture.
 */
function asksForPhonePanel(): boolean {
  return new URLSearchParams(window.location.search).get('panel') === 'phone';
}

/** РИТМ-12's panel, in the view this page is to show. */
export function Panel() {
  const [phone] = useState(asksForPhonePanel);
  return phone ? <PhonePanel /> : <PicturePanel />;
}

/** The picture of the machine, with every control on it live. */
function PicturePanel() {
  const wiring = useWiring();
  const { keys, knobs, power, readout } = wiring;
  const [fit, setFit] = useState(false);
  const scale = useStageScale(wiring.frame);
  const plate = readout.art('plate.webp');

  return (
    <ReadoutContext.Provider value={readout}>
      <section className="rt-machine" aria-label="РИТМ-12 drum machine" data-testid="machine">
        <div className="rt-scroll" data-fit={fit}>
          <div ref={wiring.frame} className="rt-frame" data-testid="panel" data-power={power ? 'on' : 'off'}>
            <div className="rt-stage" style={{ transform: `scale(${scale})` } as CSSProperties}>
              {plate ? <img className="rt-plate" src={plate} alt="" draggable={false} data-testid="plate" /> : null}
              <Patch rect={PATCHES.power} name="power-on" shown={power} />
              <Patch rect={PATCHES.write} name="write-accents" shown={wiring.write === 'accents'} />
              <Patch rect={PATCHES.size} name="size-16" shown={wiring.size === 16} />
              {EFFECT_KINDS.map((kind) => {
                const name = EFFECT_PATCH[kind];
                return name ? <Patch key={kind} rect={PATCHES.effect} name={name} shown={wiring.effect === kind} /> : null;
              })}

              <ScreenAndMeter line={wiring.line} />

              <Key rect={BUTTONS.power} {...keys.power} />
              <Lamp place={POWER_LAMP} {...wiring.powerLamp} />

              {/* Everything but the power switch: dark and out of reach while the machine is off. */}
              <div className="rt-controls" inert={!power}>
                {INSTRUMENTS.map((instrument) => {
                  const voice = wiring.voices.find((wired) => wired.voice === instrument.voice)!;
                  const middle = (instrument.button[1] + instrument.button[3]) / 2 - 1;
                  return (
                    <div key={instrument.voice} className="rt-group">
                      <Key rect={instrument.button} {...voice.key} />
                      <Lamp place={{ x: INSTRUMENT_LAMP.x, y: middle, r: INSTRUMENT_LAMP.r }} {...voice.lamp} />
                      <PointerKnob place={instrument.knob} {...voice.level} />
                    </div>
                  );
                })}

                {STEP_KEYS.map((rect, index) => (
                  <Key key={index} rect={rect} {...wiring.steps[index]!} />
                ))}
                {PATTERN_KEYS.map((rect, index) => (
                  <Key key={index} rect={rect} {...wiring.patterns[index]!} />
                ))}

                <Key rect={BUTTONS.play} {...keys.play} />
                <Key rect={BUTTONS.stop} {...keys.stop} />
                <Key rect={BUTTONS.record} {...keys.record} />
                <Key rect={BUTTONS.mute} {...keys.mute} />
                <Key rect={BUTTONS.dice} {...keys.dice} />
                <Key rect={BUTTONS.clear} {...keys.clear} />
                <Key rect={around(SWITCHES.write)} round {...keys.write} />
                <Key rect={around(SWITCHES.effect)} round {...keys.effect} />
                <Key rect={around(SWITCHES.size)} round {...keys.size} />

                {(Object.keys(KNOBS) as KnobName[]).map((name) => (
                  <PointerKnob key={name} place={KNOBS[name]} {...knobs[name]} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* On a phone the picture's instrument buttons are too small to tap. */}
        <div className="rt-touch" inert={!power}>
          <Segmented
            label="Instrument"
            className="sb-segmented-fill rt-strip"
            value={wiring.selected}
            onChange={wiring.pressVoice}
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
          {wiring.spoken}
        </p>
      </section>
    </ReadoutContext.Provider>
  );
}

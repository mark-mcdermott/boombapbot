import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { EFFECT_KINDS } from '../document';
import { Hand, Key, Lamp, useTurning, type KnobWiring, type LampWiring } from './Controls';
import { ReadoutContext, useReadout } from './context';
import { INSTRUMENTS, PHONE_KNOBS } from './layout';
import { PhoneScreen } from './Screen';
import { EFFECTS, useWiring } from './wiring';

const TABS = [
  { id: 'voice', lettered: 'ГОЛОС', spoken: 'Voice' },
  { id: 'tempo', lettered: 'ТЕМП', spoken: 'Tempo' },
  { id: 'effect', lettered: 'ЭФФЕКТ', spoken: 'Effect' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** A knob's body is shown this wide, in the page's pixels, whatever size it was cut at. */
const KNOB_BODY = 44;
/** The marks round a knob: eleven of them over its travel, the ends and the middle longer. */
const MARKS = Array.from({ length: 11 }, (_, mark) => {
  const turn = ((-135 + 27 * mark - 90) * Math.PI) / 180;
  const reach = mark % 5 === 0 ? 31 : 29;
  return { x1: 32 + 26 * Math.cos(turn), y1: 32 + 26 * Math.sin(turn), x2: 32 + reach * Math.cos(turn), y2: 32 + reach * Math.sin(turn) };
});

/**
 * Words as they are lettered on the machine. Like the paint on the picture
 * they are for the eye and are not text of the page: the stylesheet draws
 * them, and every control has an English name of its own.
 */
function Lettered({ text, dim }: { text: string; dim?: boolean }) {
  return <span className="rt-ph-let" aria-hidden="true" data-let={text} data-dim={dim || undefined} />;
}

/** A picture cut from the panel's art. */
function Part({ file, className }: { file: string; className?: string }) {
  const src = useReadout().art(`phone/${file}`);
  return src ? <img className={className} src={src} alt="" draggable={false} /> : null;
}

/** A lamp the page lays out: the painted lamp, with its light laid over it. */
function PhoneLamp(lamp: LampWiring) {
  return (
    <span className="rt-ph-lamp">
      <Lamp className="rt-ph-light" {...lamp} />
    </span>
  );
}

interface PhoneKnobProps {
  name: keyof typeof PHONE_KNOBS;
  lettered: string;
  wiring: KnobWiring;
}

/** A knob the page lays out: its painted body, the marks round it, and its pointer line turned to where it stands. */
function PhoneKnob({ name, lettered, wiring }: PhoneKnobProps) {
  const { place, radius } = PHONE_KNOBS[name];
  const { bind } = useTurning(wiring);
  return (
    <div className="rt-ph-ctl">
      <Lettered text={lettered} />
      <div className="rt-ph-knob" {...bind}>
        <svg viewBox="0 0 64 64" aria-hidden="true">
          {MARKS.map((mark, index) => (
            <line key={index} {...mark} />
          ))}
        </svg>
        <div
          className="rt-ph-knob-art"
          style={{ width: radius * 2, height: radius * 2, '--rt-shrink': KNOB_BODY / (radius * 2) } as CSSProperties}
        >
          <Part file={`knob-${name}.png`} />
          <Hand place={place} value={wiring.value} />
        </div>
      </div>
    </div>
  );
}

/**
 * РИТМ-12's panel for a phone. It is not the picture shrunk: the page lays
 * out parts cut from the picture in a column a thumb can work, with the
 * knobs behind three tabs. It draws from the same wiring as the picture, so
 * every control is the same control.
 */
export function PhonePanel() {
  const wiring = useWiring();
  const { keys, knobs, power, readout } = wiring;
  const [tab, setTab] = useState<TabId>('voice');
  const selected = wiring.voices.find((voice) => voice.voice === wiring.selected)!;

  const art = (file: string) => {
    const src = readout.art(`phone/${file}`);
    return src ? `url(${src})` : 'none';
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!move) return;
    event.preventDefault();
    const next = TABS[(TABS.findIndex((each) => each.id === tab) + move + TABS.length) % TABS.length]!;
    setTab(next.id);
    wiring.frame.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <ReadoutContext.Provider value={readout}>
      <section className="rt-machine rt-phone" aria-label="РИТМ-12 drum machine" data-testid="machine" data-own-transport>
        <div
          ref={wiring.frame}
          className="rt-ph"
          data-testid="panel"
          data-view="phone"
          data-power={power ? 'on' : 'off'}
          style={{ '--rt-bezel': art('bezel.webp'), '--rt-cap': art('key.webp'), '--rt-lamp': art('lamp.png') } as CSSProperties}
        >
          <div className="rt-ph-top">
            <Part className="rt-ph-nameplate" file="nameplate.png" />
            <Part className="rt-ph-badge" file="badge.png" />
            <Key className="rt-ph-key rt-ph-power" {...keys.power}>
              <Part file={power ? 'power-on.webp' : 'power-off.webp'} />
            </Key>
            <PhoneLamp {...wiring.powerLamp} />
          </div>

          <div className="rt-ph-crt" aria-hidden="true">
            <div className="rt-ph-glass">
              <PhoneScreen line={wiring.line} />
            </div>
          </div>

          {/* Everything but the power switch: dark and out of reach while the machine is off. */}
          <div className="rt-ph-controls" inert={!power}>
            <div className="rt-ph-group rt-ph-pads">
              {INSTRUMENTS.map((instrument) => {
                const voice = wiring.voices.find((wired) => wired.voice === instrument.voice)!;
                return (
                  <div key={instrument.voice} className="rt-ph-pad">
                    <PhoneLamp {...voice.lamp} />
                    <Key className="rt-ph-key rt-ph-cap" {...voice.key}>
                      <Part file={`ink-${instrument.voice}.png`} />
                    </Key>
                  </div>
                );
              })}
            </div>

            <div className="rt-ph-group">
              <div className="rt-ph-head">
                <Lettered text="СЕКВЕНСЕР" />
                <Key className="rt-ph-key rt-ph-switch" {...keys.write}>
                  <Lettered text="УДАРЫ" dim={wiring.write !== 'hits'} />
                  <Part file={`write-${wiring.write}.png`} />
                  <Lettered text="АКЦЕНТЫ" dim={wiring.write !== 'accents'} />
                </Key>
              </div>
              <div className="rt-ph-steps">
                {wiring.steps.map((step, index) => (
                  <Key key={index} className="rt-ph-key rt-ph-cap rt-ph-step" {...step}>
                    {index + 1}
                  </Key>
                ))}
              </div>
            </div>

            <div className="rt-ph-row">
              {wiring.patterns.map((pattern, index) => (
                <Key key={index} className="rt-ph-key rt-ph-art rt-ph-pattern" {...pattern}>
                  <Part file={`pattern-${index + 1}.webp`} />
                </Key>
              ))}
              <span className="rt-ph-rule" />
              <Key className="rt-ph-key rt-ph-art rt-ph-square" {...keys.dice}>
                <Part file="dice.webp" />
              </Key>
              <Key className="rt-ph-key rt-ph-art rt-ph-square" {...keys.clear}>
                <Part file="clear.webp" />
              </Key>
            </div>

            <div className="rt-ph-row">
              <Key className="rt-ph-key rt-ph-art rt-ph-wide" {...keys.play}>
                <Part file="play.webp" />
              </Key>
              <Key className="rt-ph-key rt-ph-art rt-ph-wide" {...keys.stop}>
                <Part file="stop.webp" />
              </Key>
              <Key className="rt-ph-key rt-ph-art rt-ph-wide" {...keys.record}>
                <Part file="record.webp" />
              </Key>
              <span className="rt-ph-rule" />
              <Key className="rt-ph-key rt-ph-cap rt-ph-mute" {...keys.mute}>
                <Lettered text="МУТ" />
              </Key>
            </div>

            <div>
              <div className="rt-ph-tabs" role="tablist" aria-label="Knobs">
                {TABS.map((each) => (
                  <button
                    key={each.id}
                    type="button"
                    role="tab"
                    className="rt-ph-tab"
                    id={`rt-tab-${each.id}`}
                    aria-label={`${each.spoken} (${each.lettered})`}
                    aria-selected={each.id === tab}
                    aria-controls="rt-deck"
                    tabIndex={each.id === tab ? 0 : -1}
                    data-tab={each.id}
                    data-testid={`tab-${each.id}`}
                    onClick={() => setTab(each.id)}
                    onKeyDown={onTabKey}
                  >
                    <i />
                    <Lettered text={each.lettered} />
                  </button>
                ))}
              </div>
              <div className="rt-ph-deck" role="tabpanel" id="rt-deck" aria-labelledby={`rt-tab-${tab}`} data-tab={tab}>
                {tab === 'voice' ? (
                  <>
                    <PhoneKnob name="pitch" lettered="ПИТЧ" wiring={knobs.pitch} />
                    <PhoneKnob name="decay" lettered="ЗАТУХАНИЕ" wiring={knobs.decay} />
                    <PhoneKnob name="tone" lettered="ТОН" wiring={knobs.tone} />
                    <PhoneKnob name="level" lettered="УРОВЕНЬ" wiring={selected.level} />
                  </>
                ) : null}
                {tab === 'tempo' ? (
                  <>
                    <PhoneKnob name="tempo" lettered="ТЕМП" wiring={knobs.tempo} />
                    <PhoneKnob name="swing" lettered="СВИНГ" wiring={knobs.swing} />
                    <PhoneKnob name="accent" lettered="АКЦЕНТ" wiring={knobs.accent} />
                    <div className="rt-ph-ctl">
                      <Lettered text="РАЗМЕР" />
                      <Key className="rt-ph-key rt-ph-pick" {...keys.size}>
                        <Part file={`size-${wiring.size === 16 ? 16 : 12}.png`} />
                        <span className="rt-ph-names">
                          <Lettered text="16" dim={wiring.size !== 16} />
                          <Lettered text="12" dim={wiring.size === 16} />
                        </span>
                      </Key>
                    </div>
                  </>
                ) : null}
                {tab === 'effect' ? (
                  <>
                    <div className="rt-ph-ctl rt-ph-ctl-wide">
                      <Key className="rt-ph-key rt-ph-pick" {...keys.effect}>
                        <Part file={`effect-${wiring.effect}.png`} />
                        <span className="rt-ph-names">
                          {EFFECT_KINDS.map((kind) => (
                            <span key={kind} className="rt-ph-name" data-on={kind === wiring.effect || undefined}>
                              <i />
                              <Lettered text={EFFECTS[kind].shown} dim={kind !== wiring.effect} />
                            </span>
                          ))}
                        </span>
                      </Key>
                    </div>
                    <PhoneKnob name="mix" lettered="СМЕСЬ" wiring={knobs.mix} />
                    <PhoneKnob name="volume" lettered="ГРОМКОСТЬ" wiring={knobs.volume} />
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <p className="sb-visually-hidden" aria-live="polite" data-testid="spoken">
          {wiring.spoken}
        </p>
      </section>
    </ReadoutContext.Provider>
  );
}

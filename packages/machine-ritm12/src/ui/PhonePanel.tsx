import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { Hand, Key, Lamp, useTurning, type KnobWiring, type LampWiring } from './Controls';
import { ReadoutContext, useReadout } from './context';
import { EffectLabel, useSelectorAngle } from './EffectUnit';
import { INSTRUMENTS, PHONE_KNOBS } from './layout';
import { Readout } from './Readout';
import { PhoneScreen } from './Screen';
import { useDeskLamp } from './desk-lamp';
import { useLettering, useScript } from './lettering';
import { useWiring } from './wiring';

const TABS = [
  { id: 'voice', spoken: 'Voice', holds: 'pitch, decay, tone and level' },
  { id: 'tempo', spoken: 'Tempo', holds: 'tempo, swing, accent and measure' },
  { id: 'effect', spoken: 'Effect', holds: 'the effect, its mix and the volume' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** The panel is laid out for a screen up to this wide, in the page's pixels. */
const PHONE_WIDTH = 430;
/** Where there is more room than that, as on a tablet held upright, the whole panel grows, to no more than this. */
const MOST_GROWN = 1.3;

/** How much the panel grows to use the room it has. */
function useGrowth(room: RefObject<HTMLElement | null>): number {
  const [growth, setGrowth] = useState(1);
  useLayoutEffect(() => {
    const node = room.current;
    if (!node) return undefined;
    const measure = () => setGrowth(Math.round(Math.min(MOST_GROWN, Math.max(1, node.clientWidth / PHONE_WIDTH)) * 100) / 100);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [room]);
  return growth;
}

/** A knob's body is shown this wide, in the page's pixels, whatever size it was cut at. */
const KNOB_BODY = 44;
/** The marks round a knob: eleven of them over its travel, the ends and the middle longer. */
const MARKS = Array.from({ length: 11 }, (_, mark) => {
  const turn = ((-135 + 27 * mark - 90) * Math.PI) / 180;
  const reach = mark % 5 === 0 ? 31 : 29;
  return { x1: 32 + 26 * Math.cos(turn), y1: 32 + 26 * Math.sin(turn), x2: 32 + reach * Math.cos(turn), y2: 32 + reach * Math.sin(turn) };
});

/**
 * The small drawing the picture has beside a label. The lettering is there
 * to look at; these say what a control is for to someone who cannot read it.
 */
type IconName =
  | 'sequencer'
  | 'hits'
  | 'accents'
  | 'mute'
  | 'voice'
  | 'pitch'
  | 'decay'
  | 'tone'
  | 'level'
  | 'tempo'
  | 'swing'
  | 'accent'
  | 'size'
  | 'effect'
  | 'delay'
  | 'reverb'
  | 'flanger'
  | 'chorus'
  | 'volume';

/**
 * Words as they are lettered on the machine. Like the paint on the picture
 * they are for the eye and are not text of the page: the stylesheet draws
 * them, and every control has an English name of its own. A label can have
 * the picture's drawing for it in front.
 */
function Lettered({ text, dim, icon }: { text: string; dim?: boolean; icon?: IconName }) {
  return (
    <span className="rt-ph-let" aria-hidden="true" data-let={text} data-dim={dim || undefined}>
      {icon ? <Part className="rt-ph-icon" file={`icon-${icon}.png`} /> : null}
    </span>
  );
}

/** A picture cut from the panel's art. */
function Part({ file, className, style }: { file: string; className?: string; style?: CSSProperties }) {
  const src = useReadout().art(`phone/${file}`);
  return src ? <img className={className} style={style} src={src} alt="" draggable={false} /> : null;
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
  icon?: IconName;
  /** What the picture letters at the two ends of the knob's travel, if anything. */
  ends?: readonly [string, string];
  wiring: KnobWiring;
}

/** A knob the page lays out: its painted body, the marks round it, and its pointer line turned to where it stands. */
function PhoneKnob({ name, lettered, icon, ends, wiring }: PhoneKnobProps) {
  const { place, radius } = PHONE_KNOBS[name];
  const { bind } = useTurning(wiring);
  return (
    <div className="rt-ph-ctl">
      <Lettered text={lettered} icon={icon} />
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
        {ends ? (
          <span className="rt-ph-ends" aria-hidden="true">
            <i data-let={ends[0]} />
            <i data-let={ends[1]} />
          </span>
        ) : null}
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
  const { keys, knobs, power } = wiring;
  const lampLit = useDeskLamp() === 'lit';
  // With the room's light out the panel's parts are the dark room's, which are cut for every part the phone has.
  const readout = useMemo(
    () => (lampLit ? wiring.readout : { ...wiring.readout, art: (file: string) => wiring.readout.art(file.startsWith('phone/') ? `night/${file}` : file) }),
    [lampLit, wiring.readout],
  );
  const [tab, setTab] = useState<TabId>('voice');
  const room = useRef<HTMLElement>(null);
  const growth = useGrowth(room);
  const selected = wiring.voices.find((voice) => voice.voice === wiring.selected)!;
  const words = useLettering();
  const effectAngle = useSelectorAngle(wiring.effect, wiring.effects);
  const english = useScript() === 'english';

  const art = (file: string) => {
    const src = readout.art(`phone/${file}`);
    return src ? `url(${src})` : 'none';
  };
  const openTab = (next: (typeof TABS)[number]) => {
    setTab(next.id);
    readout.say(words[next.id], `${next.spoken}: ${next.holds}`);
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!move) return;
    event.preventDefault();
    const next = TABS[(TABS.findIndex((each) => each.id === tab) + move + TABS.length) % TABS.length]!;
    openTab(next);
    wiring.frame.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <ReadoutContext.Provider value={readout}>
      <section ref={room} className="rt-machine rt-phone" aria-label="РИТМ-12 drum machine" data-testid="machine" data-own-transport>
        <div
          ref={wiring.frame}
          className="rt-ph"
          data-testid="panel"
          data-view="phone"
          data-power={power ? 'on' : 'off'}
          data-lamp={lampLit ? 'lit' : 'out'}
          style={{ zoom: growth, '--rt-bezel': art('bezel.webp'), '--rt-cap': art('key.webp'), '--rt-lamp': art('lamp.png') } as CSSProperties}
        >
          <div className="rt-ph-top">
            <Part className="rt-ph-nameplate" file="nameplate.png" />
            <Part className="rt-ph-badge" file="badge.png" />
            <Key className="rt-ph-key rt-ph-power" {...keys.power}>
              <Part file={power ? 'power-on.webp' : 'power-off.webp'} />
            </Key>
            <PhoneLamp {...wiring.powerLamp} />
          </div>

          <div className="rt-ph-crt">
            <div className="rt-ph-glass" aria-hidden="true">
              <PhoneScreen line={wiring.line} />
            </div>
          </div>

          <Readout className="rt-readout-phone" name={words.status} spoken={wiring.spoken} said={wiring.said} scope={wiring.frame} idle={wiring.idle} power={power} cells={24} />

          {/* Everything but the power switch: dark and out of reach while the machine is off. */}
          <div className="rt-ph-controls" inert={!power}>
            <div className="rt-ph-group rt-ph-pads">
              {INSTRUMENTS.map((instrument) => {
                const voice = wiring.voices.find((wired) => wired.voice === instrument.voice)!;
                return (
                  <div key={instrument.voice} className="rt-ph-pad">
                    <PhoneLamp {...voice.lamp} />
                    <Key className="rt-ph-key rt-ph-cap" {...voice.key}>
                      <span className="rt-ph-ink">
                        <Part file={`ink-${instrument.voice}.svg`} />
                        <Lettered text={words.voices[instrument.voice].key} />
                      </span>
                    </Key>
                  </div>
                );
              })}
            </div>

            <div className="rt-ph-group">
              <div className="rt-ph-head">
                <Lettered text={words.sequencer} icon="sequencer" />
                <Key className="rt-ph-key rt-ph-switch" {...keys.write}>
                  <Lettered text={words.hits} icon="hits" dim={wiring.write !== 'hits'} />
                  <Part file="write-hits.png" className="rt-ph-turn" />
                  <Lettered text={words.accents} icon="accents" dim={wiring.write !== 'accents'} />
                </Key>
              </div>
              <div className="rt-ph-steps">
                {wiring.steps.map((step, index) => (
                  <Key key={index} className="rt-ph-key rt-ph-cap rt-ph-step" {...step}>
                    <i className="rt-pip" />
                    <b>{index + 1}</b>
                  </Key>
                ))}
              </div>
            </div>

            <div className="rt-ph-row">
              {wiring.patterns.map((pattern, index) => (
                <Key key={index} className="rt-ph-key rt-ph-cap rt-ph-pattern" {...pattern}>
                  <Lettered text={`${words.patterns[index]}.`} />
                </Key>
              ))}
              <Key className="rt-ph-key rt-ph-art rt-ph-square" {...keys.dice}>
                <Part file="dice.webp" />
              </Key>
              <Key className={`rt-ph-key rt-ph-square ${english ? 'rt-ph-cap rt-ph-clear-en' : 'rt-ph-art'}`} {...keys.clear}>
                {english ? <Lettered text={words.clear} /> : <Part file="clear.webp" />}
              </Key>
            </div>

            <div className="rt-ph-row">
              {(['play', 'stop', 'record'] as const).map((name) => (
                <Key key={name} className="rt-ph-key rt-ph-cap rt-ph-wide" {...keys[name]}>
                  <i className="rt-ph-glyph" data-glyph={name} />
                </Key>
              ))}
              <Key className="rt-ph-key rt-ph-cap rt-ph-mute" {...keys.mute}>
                <Lettered text={words.mute} icon="mute" />
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
                    aria-label={english ? each.spoken : `${each.spoken} (${words[each.id]})`}
                    aria-selected={each.id === tab}
                    aria-controls="rt-deck"
                    tabIndex={each.id === tab ? 0 : -1}
                    data-tab={each.id}
                    data-testid={`tab-${each.id}`}
                    onClick={() => openTab(each)}
                    onKeyDown={onTabKey}
                  >
                    <i />
                    <Lettered text={words[each.id]} icon={each.id} />
                  </button>
                ))}
              </div>
              <div className="rt-ph-deck" role="tabpanel" id="rt-deck" aria-labelledby={`rt-tab-${tab}`} data-tab={tab}>
                {tab === 'voice' ? (
                  <>
                    <PhoneKnob name="pitch" lettered={words.pitch} icon="pitch" ends={['−12', '+12']} wiring={knobs.pitch} />
                    <PhoneKnob name="decay" lettered={words.decay} icon="decay" wiring={knobs.decay} />
                    <PhoneKnob name="tone" lettered={words.tone} icon="tone" wiring={knobs.tone} />
                    <PhoneKnob name="level" lettered={words.level} icon="level" wiring={selected.level} />
                  </>
                ) : null}
                {tab === 'tempo' ? (
                  <>
                    <PhoneKnob name="tempo" lettered={words.tempo} icon="tempo" wiring={knobs.tempo} />
                    <PhoneKnob name="swing" lettered={words.swing} icon="swing" wiring={knobs.swing} />
                    <PhoneKnob name="accent" lettered={words.accent} icon="accent" wiring={knobs.accent} />
                    <div className="rt-ph-ctl">
                      <Lettered text={words.size} icon="size" />
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
                        <Part className="rt-ph-effect-knob" file="effect-knob.png" style={{ transform: `rotate(${effectAngle}deg)` }} />
                        <span className="rt-ph-window">
                          <Part file="effect-window.png" />
                          <EffectLabel className="rt-ph-effect-label" kind={wiring.effect} name={words.effects[wiring.effect]} leftOut={wiring.effectLeftOut} />
                        </span>
                      </Key>
                    </div>
                    <PhoneKnob name="mix" lettered={words.mix} ends={['0', '100%']} wiring={knobs.mix} />
                    <PhoneKnob name="volume" lettered={words.volume} icon="volume" wiring={knobs.volume} />
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>
    </ReadoutContext.Provider>
  );
}

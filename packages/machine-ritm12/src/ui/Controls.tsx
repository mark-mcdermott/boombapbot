import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useKnob } from '@boombapbot/editor';
import { useReadout } from './context';
import { KNOB_SWEEP, POINTER_SIZE, handTransform, type KnobPlace, type Rect } from './layout';

/** Where a rectangle of the picture sits on the stage. */
export function boxOf([left, top, right, bottom]: Rect): CSSProperties {
  return { left, top, width: right - left, height: bottom - top };
}

/** Where a circle of the picture sits on the stage. */
export function circleOf(x: number, y: number, r: number): CSSProperties {
  return { left: x - r, top: y - r, width: 2 * r, height: 2 * r };
}

/** After a mouse press the space bar should run the transport, not press that button again. */
function releaseMouseFocus(event: MouseEvent<HTMLButtonElement>): void {
  if (event.detail > 0) event.currentTarget.blur();
}

/** What a key is and does, whichever view of the panel draws it. */
export interface KeyWiring {
  label: string;
  testId: string;
  onPress(): void;
  /** Lit from inside, as a key that is on. */
  lit?: boolean;
  /** Lit red, not amber. */
  red?: boolean;
  /** The step sounding now. */
  now?: boolean;
  /** Dimmed: a step the measure does not reach. */
  unused?: boolean;
  /** Flashing: chosen, and waiting for the bar line. */
  blink?: boolean;
  /** Said to a screen reader as on or off, for a key that stays down. */
  pressed?: boolean;
  disabled?: boolean;
  onKeyDown?(event: KeyboardEvent<HTMLButtonElement>): void;
  data?: Record<`data-${string}`, string | number>;
}

interface KeyProps extends KeyWiring {
  /** Where it is on the picture. A key the page lays out itself has none. */
  rect?: Rect;
  /** A round area of the picture, not a square one. */
  round?: boolean;
  /** Its class when it is not a key of the picture. */
  className?: string;
  children?: ReactNode;
}

/**
 * A key or button. On the picture it is an area over the paint that can be
 * pressed, lit by laying light on it; laid out by the page it carries its own
 * art as children.
 */
export function Key(props: KeyProps) {
  return (
    <button
      type="button"
      className={props.className ?? 'rt-key'}
      style={props.rect ? boxOf(props.rect) : undefined}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.pressed}
      aria-disabled={props.disabled || undefined}
      data-testid={props.testId}
      data-lit={props.lit || undefined}
      data-red={props.red || undefined}
      data-now={props.now || undefined}
      data-unused={props.unused || undefined}
      data-blink={props.blink || undefined}
      data-round={props.round || undefined}
      onKeyDown={props.onKeyDown}
      onClick={(event) => {
        releaseMouseFocus(event);
        if (!props.disabled) props.onPress();
      }}
      {...props.data}
    >
      {props.children}
    </button>
  );
}

/** How a lamp stands, whichever view of the panel draws it. */
export interface LampWiring {
  /** How brightly it glows when nothing is happening, from 0 to 1. */
  glow: number;
  /** The step on which its voice is sounding now, if it is. The lamp flashes as each one starts. */
  hit?: number;
  /** How many times its button has been pressed. The lamp flashes at each press. */
  taps?: number;
  testId: string;
}

interface LampProps extends LampWiring {
  /** Where it is on the picture. A lamp the page lays out itself has no place. */
  place?: { x: number; y: number; r: number };
  /** Its class when it is not a lamp of the picture. */
  className?: string;
}

/** How long a lamp flashes for a hit, in milliseconds. */
const FLASH_MS = 140;

/** A lamp, lit by laying light over it. */
export function Lamp({ place, className = 'rt-lamp', glow, hit, taps = 0, testId }: LampProps) {
  const element = useRef<HTMLDivElement>(null);
  const flash = () => {
    element.current?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: glow }], FLASH_MS);
  };
  useEffect(() => {
    if (hit !== undefined) flash();
    // Only a new hit flashes the lamp, never a change of its resting glow.
  }, [hit]);
  const pressed = useRef(taps);
  useEffect(() => {
    if (pressed.current === taps) return;
    pressed.current = taps;
    flash();
  }, [taps]);
  return (
    <div
      ref={element}
      className={className}
      style={{ ...(place ? circleOf(place.x, place.y, place.r) : undefined), '--rt-glow': glow } as CSSProperties}
      data-testid={testId}
      data-on={glow > 0 || undefined}
    />
  );
}

/** Another picture of a stepped control, laid over the plate while the control is in that position. */
export function Patch({ rect, name, shown }: { rect: Rect; name: string; shown: boolean }) {
  const src = useReadout().art(`patch/${name}.png`);
  if (!src) return null;
  return <img className="rt-patch" style={boxOf(rect)} src={src} alt="" draggable={false} data-shown={shown || undefined} />;
}

/** What a knob is and does, whichever view of the panel draws it. */
export interface KnobWiring {
  label: string;
  testId: string;
  /** Where the knob stands, from 0 to 1. */
  value: number;
  /** Where a double click puts it back. */
  rest: number;
  /** What a position reads as, in English, for a screen reader. */
  spoken(value: number): string;
  /** What the machine's screen shows for a position as the knob turns. */
  shown(value: number): string;
  onChange(value: number): void;
}

/**
 * What turns a knob: dragged up and down, turned with the arrow keys, put
 * back with a double click. Each change goes to the machine and is said on
 * its screen. Spread `bind` on the knob's element.
 */
export function useTurning(wiring: KnobWiring) {
  const { value } = wiring;
  const readout = useReadout();
  const [dragging, setDragging] = useState(false);
  const change = (next: number) => {
    const position = Math.min(1, Math.max(0, next));
    if (position === value) return;
    wiring.onChange(position);
    readout.say(wiring.shown(position), `${wiring.label}: ${wiring.spoken(position)}`);
  };
  const knob = useKnob({
    label: wiring.label,
    value,
    min: 0,
    max: 1,
    step: 0.02,
    perPixel: 1 / 220,
    valueText: wiring.spoken(value),
    onChange: change,
  });
  return {
    dragging,
    bind: {
      ...knob,
      title: wiring.label,
      'data-testid': wiring.testId,
      'data-dragging': dragging || undefined,
      onPointerDown(event: PointerEvent<HTMLElement>) {
        setDragging(true);
        knob.onPointerDown(event);
      },
      onPointerUp() {
        setDragging(false);
        knob.onPointerUp();
      },
      onPointerCancel() {
        setDragging(false);
        knob.onPointerCancel();
      },
      onDoubleClick: () => change(wiring.rest),
    },
  };
}

/** A knob's pointer line, turned to where the knob stands. It sits in the picture's own pixels, about the knob's centre. */
export function Hand({ place, value }: { place: KnobPlace; value: number }) {
  const pointer = useReadout().art(`pointer/${place.kind}.png`);
  return (
    <div
      className="rt-hand"
      style={{
        left: `calc(50% + ${place.pivot[0] - POINTER_SIZE / 2}px)`,
        top: `calc(50% + ${place.pivot[1] - POINTER_SIZE / 2}px)`,
        width: POINTER_SIZE,
        height: POINTER_SIZE,
        backgroundImage: pointer ? `url(${pointer})` : undefined,
        transform: handTransform((value - 0.5) * KNOB_SWEEP, place),
      }}
    />
  );
}

interface PointerKnobProps extends KnobWiring {
  place: KnobPlace;
}

/**
 * A knob of the picture. Its painted body and the light on it stay still:
 * only its pointer line, a picture of its own, turns. Drag it up and down,
 * turn it with the arrow keys, and double click to put it back. The wheel is
 * left alone, so scrolling the page over the machine cannot turn a knob.
 */
export function PointerKnob(props: PointerKnobProps) {
  const { place } = props;
  const { bind } = useTurning(props);
  return (
    <div className="rt-knob" style={circleOf(place.x, place.y, place.r)} {...bind}>
      <Hand place={place} value={props.value} />
    </div>
  );
}

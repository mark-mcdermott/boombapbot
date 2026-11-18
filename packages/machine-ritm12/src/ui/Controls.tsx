import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
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

interface KeyProps {
  rect: Rect;
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
  round?: boolean;
  /** Said to a screen reader as on or off, for a key that stays down. */
  pressed?: boolean;
  disabled?: boolean;
  onKeyDown?(event: KeyboardEvent<HTMLButtonElement>): void;
  data?: Record<`data-${string}`, string | number>;
}

/** A key or button of the picture: an area over it that can be pressed, lit by laying light on the paint. */
export function Key(props: KeyProps) {
  return (
    <button
      type="button"
      className="rt-key"
      style={boxOf(props.rect)}
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
    />
  );
}

interface LampProps {
  x: number;
  y: number;
  r: number;
  /** How brightly it glows when nothing is happening, from 0 to 1. */
  glow: number;
  /** The step on which its voice is sounding now, if it is. The lamp flashes as each one starts. */
  hit?: number;
  /** How many times its button has been pressed. The lamp flashes at each press. */
  taps?: number;
  testId: string;
}

/** How long a lamp flashes for a hit, in milliseconds. */
const FLASH_MS = 140;

/** A lamp of the picture, lit by laying light over it. */
export function Lamp({ x, y, r, glow, hit, taps = 0, testId }: LampProps) {
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
      className="rt-lamp"
      style={{ ...circleOf(x, y, r), '--rt-glow': glow } as CSSProperties}
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

interface PointerKnobProps {
  place: KnobPlace;
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
 * A knob of the picture. Its painted body and the light on it stay still:
 * only its pointer line, a picture of its own, turns. Drag it up and down,
 * turn it with the arrow keys, and double click to put it back. The wheel is
 * left alone, so scrolling the page over the machine cannot turn a knob.
 */
export function PointerKnob(props: PointerKnobProps) {
  const { place, value } = props;
  const readout = useReadout();
  const [dragging, setDragging] = useState(false);
  const change = (next: number) => {
    const position = Math.min(1, Math.max(0, next));
    if (position === value) return;
    props.onChange(position);
    readout.say(props.shown(position), `${props.label}: ${props.spoken(position)}`);
  };
  const knob = useKnob({
    label: props.label,
    value,
    min: 0,
    max: 1,
    step: 0.02,
    perPixel: 1 / 220,
    valueText: props.spoken(value),
    onChange: change,
  });

  const pointer = readout.art(`pointer/${place.kind}.png`);
  return (
    <div
      className="rt-knob"
      style={circleOf(place.x, place.y, place.r)}
      title={props.label}
      data-testid={props.testId}
      data-dragging={dragging || undefined}
      {...knob}
      onPointerDown={(event) => {
        setDragging(true);
        knob.onPointerDown(event);
      }}
      onPointerUp={() => {
        setDragging(false);
        knob.onPointerUp();
      }}
      onPointerCancel={() => {
        setDragging(false);
        knob.onPointerCancel();
      }}
      onDoubleClick={() => change(props.rest)}
    >
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
    </div>
  );
}

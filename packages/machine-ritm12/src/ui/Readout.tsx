import { useCallback, useEffect, useId, useMemo, useState, type RefObject } from 'react';
import { ALL_SEGMENTS, CELL, POINT, cellsOf, litPath, readable, windowOf, type Cell } from './segments';

/** How long a line a control put up stays, in milliseconds. */
const HOLD_MS = 3200;
/** How long a long line rests before it starts to run, and how long each step of it takes. */
const LEAD_MS = 700;
const STEP_MS = 150;
/** The characters lean, as a readout's do. */
const LEAN = -6;

interface Message {
  text: string;
  /** Kept up while its control has the focus, not for a moment. */
  sticky: boolean;
  id: number;
}

/**
 * A long line on a readout that cannot move: as much as fits, and three
 * points to say there is more.
 */
function cutShort(cells: readonly Cell[], count: number): Cell[] {
  if (cells.length <= count) return windowOf(cells, 0, count);
  const kept = cells.slice(0, count - 2).map((cell) => ({ ...cell }));
  kept[kept.length - 1]!.point = true;
  return [...kept, { lit: [], point: true }, { lit: [], point: true }];
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const follow = () => setReduced(query.matches);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);
  return reduced;
}

/**
 * What the readout shows: the line a control last said, for a moment, or
 * the name of the control the keyboard is on, for as long as it is there.
 */
function useMessage(spoken: string, said: number, scope: RefObject<HTMLElement | null>): [Message | null, () => void] {
  const [message, setMessage] = useState<Message | null>(null);
  useEffect(() => {
    if (said > 0) setMessage({ text: spoken, sticky: false, id: said });
  }, [said, spoken]);
  useEffect(() => {
    const node = scope.current;
    if (!node) return undefined;
    let focused = 0;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      const name = target.getAttribute('aria-label');
      if (!name || !target.matches(':focus-visible')) return;
      focused -= 1;
      setMessage({ text: name, sticky: true, id: focused });
    };
    const onFocusOut = () => setMessage((now) => (now?.sticky ? null : now));
    node.addEventListener('focusin', onFocusIn);
    node.addEventListener('focusout', onFocusOut);
    return () => {
      node.removeEventListener('focusin', onFocusIn);
      node.removeEventListener('focusout', onFocusOut);
    };
  }, [scope]);
  const clear = useCallback(() => setMessage(null), []);
  return [message, clear];
}

interface ReadoutProps {
  /** The line the panel last said, in English. */
  spoken: string;
  /** How many lines have been said: a new count is a new line, even of the same words. */
  said: number;
  /** The panel, whose controls put their names up when the keyboard reaches them. */
  scope: RefObject<HTMLElement | null>;
  /** What it shows while nothing has been said: where the machine stands. */
  idle: string;
  power: boolean;
  /** How many characters it has. A longer line runs across it. */
  cells: number;
  className: string;
}

/**
 * A strip of sixteen-segment characters under the screen that says in
 * English what a control is or just did, for whoever can see the Russian
 * lettering and not read it. Its unlit segments show faintly, as a real
 * readout's do. It is also the panel's live line for a screen reader, which
 * hears what controls say but not the names of those it moves to, since it
 * announces those itself.
 */
export function Readout({ spoken, said, scope, idle, power, cells: count, className }: ReadoutProps) {
  const [message, clear] = useMessage(spoken, said, scope);
  const reduced = useReducedMotion();
  const [offset, setOffset] = useState(0);
  const text = power ? (message?.text ?? idle) : '';
  const cells = useMemo(() => cellsOf(readable(text)), [text]);
  const runs = cells.length > count && !reduced;
  const last = cells.length - count;

  useEffect(() => setOffset(0), [message]);

  useEffect(() => {
    if (!message) return undefined;
    if (runs && offset < last) {
      const timer = window.setTimeout(() => setOffset(offset + 1), offset === 0 ? LEAD_MS : STEP_MS);
      return () => window.clearTimeout(timer);
    }
    if (message.sticky && !runs) return undefined;
    const timer = window.setTimeout(() => (message.sticky ? setOffset(0) : clear()), HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [message, runs, offset, last, clear]);

  const shown = runs ? windowOf(cells, offset, count) : cutShort(cells, count);
  const ghost = useId();
  const width = count * CELL.width;

  return (
    <div className={`rt-readout ${className}`} data-testid="readout" data-power={power ? 'on' : 'off'} data-text={message?.text ?? ''}>
      <i className="rt-readout-screw" />
      <div className="rt-readout-glass">
        <svg viewBox={`-6 -5 ${width + 12} ${CELL.height + 10}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            <path id={ghost} d={ALL_SEGMENTS} />
          </defs>
          <g transform={`translate(${-Math.tan((LEAN * Math.PI) / 180) * CELL.height / 2} 0) skewX(${LEAN})`}>
            {shown.map((cell, index) => (
              <g key={index} transform={`translate(${index * CELL.width} 0)`}>
                <use href={`#${ghost}`} className="rt-readout-off" />
                <rect className={cell.point ? 'rt-readout-on' : 'rt-readout-off'} x={POINT.x} y={POINT.y} width={POINT.size} height={POINT.size} />
                {cell.lit.length ? <path className="rt-readout-on" d={litPath(cell)} /> : null}
              </g>
            ))}
          </g>
        </svg>
      </div>
      <i className="rt-readout-screw" />
      <span className="sb-visually-hidden" aria-live="polite" data-testid="spoken">
        {spoken}
      </span>
    </div>
  );
}

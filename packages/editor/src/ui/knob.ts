import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

export interface KnobOptions {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Change for one arrow key. Page Up and Page Down move ten times as far. */
  step: number;
  /** Change for each pixel dragged upwards. */
  perPixel: number;
  valueText?: string;
  onChange(value: number): void;
}

/**
 * What makes an element a knob: a slider to a screen reader, dragged up and
 * down with a pointer, turned with the arrow keys, Page Up and Down, Home and
 * End. Spread the result on the element; how the knob looks is its own business.
 */
export function useKnob(options: KnobOptions) {
  const { value, min, max, step, onChange } = options;
  const drag = useRef<{ y: number; value: number } | null>(null);
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  const release = () => {
    drag.current = null;
  };

  return {
    role: 'slider' as const,
    tabIndex: 0,
    'aria-label': options.label,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': value,
    'aria-valuetext': options.valueText,
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      const steps: Record<string, number> = {
        ArrowUp: step,
        ArrowRight: step,
        ArrowDown: -step,
        ArrowLeft: -step,
        PageUp: step * 10,
        PageDown: -step * 10,
      };
      const change = steps[event.key];
      if (change !== undefined) {
        event.preventDefault();
        set(value + change);
      } else if (event.key === 'Home') {
        event.preventDefault();
        set(min);
      } else if (event.key === 'End') {
        event.preventDefault();
        set(max);
      }
    },
    onPointerDown(event: PointerEvent<HTMLElement>) {
      drag.current = { y: event.clientY, value };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if (!drag.current) return;
      set(drag.current.value + (drag.current.y - event.clientY) * options.perPixel);
    },
    onPointerUp: release,
    onPointerCancel: release,
  };
}

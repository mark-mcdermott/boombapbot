import { Tooltip } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode, RefObject } from 'react';

/** How long a pointer rests on a control before its tip shows. */
const DELAY_MS = 350;

/**
 * Wraps a row of controls that have tips. Once one tip is showing, moving to
 * a neighbour shows the next at once.
 */
export function TipGroup({ children }: { children: ReactNode }) {
  return <Tooltip.Provider delay={DELAY_MS}>{children}</Tooltip.Provider>;
}

interface TipProps {
  /** What the control is, in a word or two. */
  label: string;
  /** Where the tip mounts, so it inherits the page's theme. */
  container: RefObject<HTMLElement | null>;
  /** The control. It keeps its own accessible name; the tip is for the eye. */
  children: ReactElement<Record<string, unknown>>;
}

/**
 * A small label over an icon-only control, shown when it is pointed at or
 * reached by keyboard. It repeats the control's name, so it is hidden from
 * screen readers, which already have it.
 */
export function Tip({ label, container, children }: TipProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal container={container}>
        <Tooltip.Positioner className="sb-tip-positioner" side="top" sideOffset={6} collisionPadding={8}>
          <Tooltip.Popup className="sb-tip" data-testid="tip" aria-hidden="true">
            <Tooltip.Arrow className="sb-tip-arrow" />
            <span className="sb-tip-text">{label}</span>
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

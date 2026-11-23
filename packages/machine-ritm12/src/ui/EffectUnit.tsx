import { useRef, type CSSProperties } from 'react';
import type { EffectKind } from '../document';
import { Patch, boxOf, circleOf } from './Controls';
import { useReadout } from './context';
import { EFFECT_UNIT } from './layout';

/**
 * How far the selector has turned, in positions. It only ever turns one way:
 * past the last effect it goes on round to the first, so it never spins back.
 * With a different number of effects it starts again from where it stands.
 */
export function useSelectorTurns(index: number, count: number): number {
  const turned = useRef({ index, count, turns: index });
  const last = turned.current;
  if (last.count !== count) turned.current = { index, count, turns: index };
  else if (last.index !== index) turned.current = { index, count, turns: last.turns + ((index - last.index + count) % count) };
  return turned.current.turns;
}

/** The angle the selector has turned through from where it is painted, with its positions spread evenly round it. */
export function selectorAngle(turns: number, count: number): number {
  return (turns * 360) / count;
}

/** The unit's paint with the window in it, and the selector turned to its effect, from whichever set of pictures is being read. */
export function EffectUnitArt({ angle }: { angle: number }) {
  const knob = useReadout().art('patch/effect-knob.png');
  const { x, y, r } = EFFECT_UNIT.knob;
  return (
    <>
      <Patch rect={EFFECT_UNIT.patch} name="effect-unit" shown />
      {knob ? (
        <img className="rt-effect-knob" style={{ ...circleOf(x, y, r), transform: `rotate(${angle}deg)` }} src={knob} alt="" draggable={false} />
      ) : null}
    </>
  );
}

/**
 * What is printed on the label in the window: the effect's drawing and its
 * name. The picture says where on its plate the label is; the phone's panel
 * places it over its own cut of the window.
 */
export function EffectLabel({ kind, name, className, style }: { kind: EffectKind; name: string; className?: string; style?: CSSProperties }) {
  const icon = useReadout().art(`phone/icon-${kind}.png`);
  return (
    <span className={className ? `rt-effect-label ${className}` : 'rt-effect-label'} style={style} aria-hidden="true" data-testid="effect-label" data-effect={kind}>
      {icon ? <i className="rt-effect-icon" style={{ '--rt-effect-icon': `url("${icon}")` } as CSSProperties} /> : null}
      <span data-let={name} />
    </span>
  );
}

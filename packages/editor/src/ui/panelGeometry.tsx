import type { CSSProperties } from 'react';
import type { PanelManifest, PanelRect } from '@boombapbot/contracts';

/** Positions a faceplate rectangle as percentages, so it scales with the image. */
export function box(panel: PanelManifest, [x, y, w, h]: PanelRect): CSSProperties {
  const { width, height } = panel.faceplate;
  return {
    left: `${(x / width) * 100}%`,
    top: `${(y / height) * 100}%`,
    width: `${(w / width) * 100}%`,
    height: `${(h / height) * 100}%`,
  };
}

export function circle(panel: PanelManifest, cx: number, cy: number, r: number): CSSProperties {
  return box(panel, [cx - r, cy - r, r * 2, r * 2]);
}

/**
 * A knob cut from the faceplate photo: a round window onto the photo that
 * turns about the knob's centre. Without a photo it is drawn instead.
 */
export function KnobFace(props: {
  panel: PanelManifest;
  photo: string | null;
  cx: number;
  cy: number;
  r: number;
  photoDeg: number;
  deg: number;
}) {
  const { panel, photo, cx, cy, r } = props;
  const { width, height } = panel.faceplate;
  if (!photo) {
    return (
      <span className="sb-knob-drawn" style={{ transform: `rotate(${props.deg}deg)` }}>
        <span className="sb-knob-pointer" />
      </span>
    );
  }
  return (
    <span
      className="sb-knob-photo"
      style={{
        backgroundImage: `url("${photo}")`,
        backgroundSize: `${(width / (2 * r)) * 100}% auto`,
        backgroundPosition: `${((cx - r) / (width - 2 * r)) * 100}% ${((cy - r) / (height - 2 * r)) * 100}%`,
        transform: `rotate(${props.deg - props.photoDeg}deg)`,
      }}
    />
  );
}

/**
 * Artwork drawn for boombapbot shades its knobs evenly, so the light on them
 * can stay put while they turn. A photograph carries its own light.
 */
export function knobLighting(panel: PanelManifest, photo: string | null): 'fixed' | undefined {
  return photo && panel.faceplate.original ? 'fixed' : undefined;
}

/** A knob the pointer cannot turn: it shows where a selector stands. */
export function PassiveKnob(props: {
  panel: PanelManifest;
  photo: string | null;
  knob: { cx: number; cy: number; r: number; photoDeg: number };
  deg: number;
}) {
  const { panel, photo, knob } = props;
  return (
    <span
      className="sb-panel-knob sb-panel-knob-passive"
      data-lighting={knobLighting(panel, photo)}
      style={circle(panel, knob.cx, knob.cy, knob.r)}
      aria-hidden="true"
    >
      <KnobFace panel={panel} photo={photo} cx={knob.cx} cy={knob.cy} r={knob.r} photoDeg={knob.photoDeg} deg={props.deg} />
    </span>
  );
}

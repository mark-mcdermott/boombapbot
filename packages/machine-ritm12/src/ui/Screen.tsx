import { useEffect, useRef, type RefObject } from 'react';
import { VOICES, isStepOn, type Project } from '../document';
import { useRuntime } from './context';
import { INSTRUMENTS, METER, SCREEN, meterAngle } from './layout';
import { boxOf } from './Controls';
import { useLettering, type Lettering } from './lettering';

const GREEN = '#66ff9c';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
/** Seconds the tube takes to light, and to finish typing its start-up lines. */
const WARM = 0.45;
const BOOTED = 2.3;
/** A level this many decibels below full reads 0 on the meter. */
const METER_REFERENCE = 14;

/** What a control last said, and until when the screen shows it. */
export interface ScreenLine {
  text: string;
  until: number;
}

interface ScreenProps {
  /** The line a control wants shown for a moment, if any. */
  line: { current: ScreenLine };
}

/** How the screen is laid out, in pixels of its own. The picture's screen and the phone's are two shapes of one drawing. */
export interface ScreenShape {
  width: number;
  height: number;
  /** Canvas pixels to each of the shape's own. */
  density: number;
  /** How far the glow of the green spreads, against the picture's. */
  glow: number;
  /** The line along the top: the pattern on the left, the tempo on the right, and the rule under them. */
  head: { font: string; left: number; right: number; base: number; rule: number };
  /** The grid of steps. `text` is how far under a row's top its name stands; a cell is drawn `inset` from its sides and `trim` short of the row. */
  grid: { font: string; label: number; left: number; top: number; width: number; row: number; text: number; inset: number; trim: number };
  /** The marks under the grid for accented steps. */
  accent: { drop: number; inset: number; height: number };
  /** The line along the bottom. */
  foot: { font: string; left: number; base: number };
  /** The lines typed out when the machine is switched on. */
  boot: { left: number; top: number; gap: number };
}

/** The screen as it is painted on the picture. */
export const PICTURE_SCREEN: ScreenShape = {
  width: SCREEN.width,
  height: SCREEN.height,
  density: 2,
  glow: 1,
  head: { font: `600 15px ${MONO}`, left: 38, right: 432, base: 44, rule: 52 },
  grid: { font: `600 12px ${MONO}`, label: 36, left: 88, top: 62, width: 344, row: 20, text: 13, inset: 2, trim: 5 },
  accent: { drop: 3, inset: 5, height: 3 },
  foot: { font: `600 13px ${MONO}`, left: 48, base: 251 },
  boot: { left: 40, top: 62, gap: 24 },
};

/** The phone's screen: wider for its height, and sized in the phone's own pixels. */
export const PHONE_SCREEN: ScreenShape = {
  width: 304,
  height: 128,
  density: 3,
  glow: 0.6,
  head: { font: `700 9px ${MONO}`, left: 12, right: 292, base: 15, rule: 20 },
  grid: { font: `700 8px ${MONO}`, label: 11, left: 44, top: 25, width: 248, row: 10.5, text: 7.5, inset: 1.5, trim: 3.5 },
  accent: { drop: 1.5, inset: 3.5, height: 2 },
  foot: { font: `700 9px ${MONO}`, left: 12, base: 122 },
  boot: { left: 14, top: 24, gap: 14.5 },
};

/**
 * Draws the screen on a canvas a frame at a time, from the store, outside
 * React: nothing re-renders as the machine plays. `each` is called on every
 * frame with whether the power is on, for whatever else moves with it.
 */
export function useScreen(
  canvas: RefObject<HTMLCanvasElement | null>,
  line: { current: ScreenLine },
  shape: ScreenShape,
  each?: (power: boolean) => void,
): void {
  const runtime = useRuntime();
  const onFrame = useRef(each);
  onFrame.current = each;
  const words = useLettering();
  const lettering = useRef(words);
  lettering.current = words;

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return undefined;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let power = runtime.store.getState().power;
    // Someone who asked for less motion gets the screen already on.
    let switchedAt = still ? -Infinity : performance.now();
    let frame = 0;

    const draw = (now: number) => {
      const state = runtime.store.getState();
      if (state.power !== power) {
        power = state.power;
        switchedAt = still ? -Infinity : now;
      }
      drawScreen(context, shape, state.project, lettering.current, {
        power,
        since: (now - switchedAt) / 1000,
        step: state.currentStep,
        playing: state.currentPattern,
        recording: state.transient.recording,
        line: now < line.current.until ? line.current.text : null,
      });
      if (canvas.current && !still) canvas.current.style.opacity = String(power ? 0.93 + Math.random() * 0.07 : 1);
      onFrame.current?.(power);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [runtime, canvas, line, shape]);
}

/** The picture's screen and its level meter. */
export function ScreenAndMeter({ line }: ScreenProps) {
  const runtime = useRuntime();
  const canvas = useRef<HTMLCanvasElement>(null);
  const needle = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const decibels = useRef(-40);

  useScreen(canvas, line, PICTURE_SCREEN, (power) => {
    // The needle rises quickly and falls back slowly, as a meter's does.
    const target = power ? 20 * Math.log10(runtime.outputLevel() + 1e-6) + METER_REFERENCE : -40;
    decibels.current += (target - decibels.current) * (target > decibels.current ? 0.4 : 0.07);
    const turn = `rotate(${meterAngle(decibels.current)}deg)`;
    if (needle.current) needle.current.style.transform = turn;
    if (shadow.current) shadow.current.style.transform = turn;
  });

  const { left, bottom, width, length } = METER.needle;
  const needleBox = { left: left - width / 2, bottom, width, height: length };
  const shape = PICTURE_SCREEN;
  return (
    <>
      <div className="rt-meter" style={boxOf(METER.rect)} aria-hidden="true">
        <div className="rt-meter-glow" />
        <div ref={shadow} className="rt-needle-shadow" style={needleBox} />
        <div ref={needle} className="rt-needle" style={needleBox} data-testid="meter-needle" />
      </div>
      <div className="rt-screen" style={boxOf(SCREEN.rect)} aria-hidden="true">
        <canvas ref={canvas} width={shape.width * shape.density} height={shape.height * shape.density} data-testid="screen" />
        <div className="rt-screen-lines" />
        <div className="rt-screen-glass" />
      </div>
    </>
  );
}

/** The phone's screen: the same drawing in the phone's shape, to sit inside the frame the page lays out. */
export function PhoneScreen({ line }: ScreenProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useScreen(canvas, line, PHONE_SCREEN);
  const shape = PHONE_SCREEN;
  return <canvas ref={canvas} width={shape.width * shape.density} height={shape.height * shape.density} data-testid="screen" />;
}

interface ScreenState {
  power: boolean;
  /** Seconds since the power switch was last thrown. */
  since: number;
  step: number;
  /** The pattern the engine is playing, or -1. */
  playing: number;
  recording: boolean;
  line: string | null;
}

function drawScreen(g: CanvasRenderingContext2D, shape: ScreenShape, project: Project, words: Lettering, state: ScreenState): void {
  const { width, height, glow, head, grid, accent, foot, boot } = shape;
  const middle = { x: width / 2, y: height / 2 };
  g.setTransform(shape.density, 0, 0, shape.density, 0, 0);
  g.clearRect(0, 0, width, height);
  g.shadowColor = '#35ff7c';
  g.shadowBlur = 0;
  g.globalAlpha = 1;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';

  if (!state.power) {
    // Switched off, the picture collapses to a line and is gone.
    if (state.since > 0.35) return;
    const left = 1 - state.since / 0.35;
    const across = width * 0.86 * left * left;
    g.fillStyle = `rgba(190, 255, 215, ${left})`;
    g.shadowBlur = 18 * glow;
    g.fillRect(middle.x - across / 2, middle.y, across, 2 * glow);
    return;
  }

  const bloom = g.createRadialGradient(middle.x, middle.y, width * 0.04, middle.x, middle.y, width * 0.64);
  bloom.addColorStop(0, '#07220f');
  bloom.addColorStop(1, '#020a05');
  g.fillStyle = bloom;
  g.fillRect(0, 0, width, height);

  if (state.since < WARM) {
    // Switched on, a line opens out into the picture.
    const done = state.since / WARM;
    const across = width * 0.9 * Math.min(1, done * 2);
    g.fillStyle = 'rgba(200, 255, 220, .95)';
    g.shadowBlur = 22 * glow;
    const tall = done < 0.5 ? 2 * glow : 2 * glow + (done - 0.5) * 2 * height * 0.88;
    g.fillRect(middle.x - across / 2, middle.y - tall / 2, across, tall);
    return;
  }

  g.fillStyle = GREEN;
  g.shadowBlur = 7 * glow;
  g.font = head.font;
  if (state.since < BOOTED) {
    let typed = Math.floor((state.since - WARM) * 62);
    words.boot.forEach((text, index) => {
      g.fillText(text.slice(0, Math.max(0, typed)), boot.left, boot.top + index * boot.gap);
      typed -= text.length;
    });
    return;
  }

  const shown = project.patterns[project.panel.pattern]!;
  g.fillText(`${words.pattern} ${words.patterns[project.panel.pattern]}`, head.left, head.base);
  g.textAlign = 'right';
  g.fillText(`${words.tempo} ${project.tempo}`, head.right, head.base);
  g.textAlign = 'left';
  g.globalAlpha = 0.5;
  g.fillRect(head.left, head.rule, head.right - head.left, glow);
  g.globalAlpha = 1;

  const { left, top } = grid;
  const cell = grid.width / project.size;
  const rowHeight = grid.row;
  const under = top + VOICES.length * rowHeight;
  // The running step is shown only while the pattern on the screen is the one playing.
  if (state.step >= 0 && state.playing === project.panel.pattern) {
    g.globalAlpha = 0.16;
    g.shadowBlur = 0;
    g.fillRect(left + state.step * cell, top - grid.inset, cell, under - top + accent.drop + accent.height + 3 * grid.inset);
    g.globalAlpha = 1;
  }
  g.font = grid.font;
  INSTRUMENTS.forEach((instrument, index) => {
    const y = top + index * rowHeight;
    const selected = instrument.voice === project.panel.selected;
    const quiet = project.mix.mutes[instrument.voice] ? 0.3 : 1;
    g.shadowBlur = 6 * glow;
    g.globalAlpha = (selected ? 1 : 0.55) * quiet;
    g.fillText(`${selected ? '▸' : ' '}${words.voices[instrument.voice].short}`, grid.label, y + grid.text);
    for (let step = 0; step < project.size; step += 1) {
      const on = isStepOn(shown.steps[instrument.voice], step);
      g.globalAlpha = (on ? 1 : 0.2) * quiet;
      g.shadowBlur = on ? 9 * glow : 0;
      if (on) {
        g.fillRect(left + step * cell + grid.inset, y + grid.inset, cell - 2 * grid.inset, rowHeight - grid.trim);
      } else {
        g.strokeStyle = GREEN;
        g.lineWidth = glow;
        g.strokeRect(left + step * cell + grid.inset + glow / 2, y + grid.inset + glow / 2, cell - 2 * grid.inset - glow, rowHeight - grid.trim - glow);
      }
    }
  });
  g.globalAlpha = 1;
  g.shadowBlur = 6 * glow;
  for (let step = 0; step < project.size; step += 1) {
    if (isStepOn(shown.accents, step)) g.fillRect(left + step * cell + accent.inset, under + accent.drop, cell - 2 * accent.inset, accent.height);
  }

  g.font = foot.font;
  const resting = `${project.size === 16 ? `16 ${words.straight}` : `12 ${words.triplets}`}  ${words.effects[project.effect.kind]}${state.recording ? `  ● ${words.recording}` : ''}`;
  g.fillText(state.line ?? resting, foot.left, foot.base);
}

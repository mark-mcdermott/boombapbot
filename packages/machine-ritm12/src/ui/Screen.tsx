import { useEffect, useRef } from 'react';
import { PATTERN_NAMES, VOICES, isStepOn, type Project } from '../document';
import { useRuntime } from './context';
import { INSTRUMENTS, METER, SCREEN, meterAngle } from './layout';
import { boxOf } from './Controls';

const GREEN = '#66ff9c';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
/** What the screen types out when the machine is switched on. */
const BOOT_LINES = ['НПО «БАРС-7»', 'РИТМ-12  РИТМИЧЕСКИЙ КОМПЬЮТЕР', '', 'ПРОВЕРКА ПАМЯТИ ........ ОК', 'ГОЛОСА 8    ПАТТЕРНЫ 4', '', 'ГОТОВ'];
const EFFECT_NAMES: Record<Project['effect']['kind'], string> = { delay: 'ДИЛЭЙ', reverb: 'РЕВЕРБ', flanger: 'ФЛЭНЖЕР', chorus: 'ХОР' };
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

/**
 * The machine's screen and its level meter. Both are drawn a frame at a time
 * from the store and the engine's output level, outside React: nothing here
 * re-renders as the machine plays.
 */
export function ScreenAndMeter({ line }: ScreenProps) {
  const runtime = useRuntime();
  const canvas = useRef<HTMLCanvasElement>(null);
  const needle = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return undefined;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let power = runtime.store.getState().power;
    // Someone who asked for less motion gets the screen already on.
    let switchedAt = still ? -Infinity : performance.now();
    let decibels = -40;
    let frame = 0;

    const draw = (now: number) => {
      const state = runtime.store.getState();
      if (state.power !== power) {
        power = state.power;
        switchedAt = still ? -Infinity : now;
      }
      drawScreen(context, state.project, {
        power,
        since: (now - switchedAt) / 1000,
        step: state.currentStep,
        playing: state.currentPattern,
        recording: state.transient.recording,
        line: now < line.current.until ? line.current.text : null,
      });
      if (canvas.current && !still) canvas.current.style.opacity = String(power ? 0.93 + Math.random() * 0.07 : 1);

      // The needle rises quickly and falls back slowly, as a meter's does.
      const target = power ? 20 * Math.log10(runtime.outputLevel() + 1e-6) + METER_REFERENCE : -40;
      decibels += (target - decibels) * (target > decibels ? 0.4 : 0.07);
      const turn = `rotate(${meterAngle(decibels)}deg)`;
      if (needle.current) needle.current.style.transform = turn;
      if (shadow.current) shadow.current.style.transform = turn;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [runtime, line]);

  const { left, bottom, width, length } = METER.needle;
  const needleBox = { left: left - width / 2, bottom, width, height: length };
  return (
    <>
      <div className="rt-meter" style={boxOf(METER.rect)} aria-hidden="true">
        <div className="rt-meter-glow" />
        <div ref={shadow} className="rt-needle-shadow" style={needleBox} />
        <div ref={needle} className="rt-needle" style={needleBox} data-testid="meter-needle" />
      </div>
      <div className="rt-screen" style={boxOf(SCREEN.rect)} aria-hidden="true">
        <canvas ref={canvas} width={SCREEN.width * 2} height={SCREEN.height * 2} data-testid="screen" />
        <div className="rt-screen-lines" />
        <div className="rt-screen-glass" />
      </div>
    </>
  );
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

function drawScreen(g: CanvasRenderingContext2D, project: Project, state: ScreenState): void {
  const { width, height } = SCREEN;
  const middle = { x: width / 2, y: height / 2 };
  g.setTransform(2, 0, 0, 2, 0, 0);
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
    g.fillStyle = `rgba(190, 255, 215, ${left})`;
    g.shadowBlur = 18;
    g.fillRect(middle.x - 200 * left * left, middle.y, 400 * left * left, 2);
    return;
  }

  const bloom = g.createRadialGradient(middle.x, middle.y, 20, middle.x, middle.y, 300);
  bloom.addColorStop(0, '#07220f');
  bloom.addColorStop(1, '#020a05');
  g.fillStyle = bloom;
  g.fillRect(0, 0, width, height);

  if (state.since < WARM) {
    // Switched on, a line opens out into the picture.
    const done = state.since / WARM;
    g.fillStyle = 'rgba(200, 255, 220, .95)';
    g.shadowBlur = 22;
    const tall = done < 0.5 ? 2 : 2 + (done - 0.5) * 2 * 240;
    g.fillRect(middle.x - 210 * Math.min(1, done * 2), middle.y - tall / 2, 420 * Math.min(1, done * 2), tall);
    return;
  }

  g.fillStyle = GREEN;
  g.shadowBlur = 7;
  g.font = `600 15px ${MONO}`;
  if (state.since < BOOTED) {
    let typed = Math.floor((state.since - WARM) * 62);
    BOOT_LINES.forEach((text, index) => {
      g.fillText(text.slice(0, Math.max(0, typed)), 40, 62 + index * 24);
      typed -= text.length;
    });
    return;
  }

  const shown = project.patterns[project.panel.pattern]!;
  g.fillText(`ПАТТЕРН ${PATTERN_NAMES[project.panel.pattern]}`, 38, 44);
  g.textAlign = 'right';
  g.fillText(`ТЕМП ${project.tempo}`, 432, 44);
  g.textAlign = 'left';
  g.globalAlpha = 0.5;
  g.fillRect(38, 52, 394, 1);
  g.globalAlpha = 1;

  const left = 88;
  const top = 62;
  const cell = 344 / project.size;
  const rowHeight = 20;
  // The running step is shown only while the pattern on the screen is the one playing.
  if (state.step >= 0 && state.playing === project.panel.pattern) {
    g.globalAlpha = 0.16;
    g.shadowBlur = 0;
    g.fillRect(left + state.step * cell, top - 2, cell, VOICES.length * rowHeight + 12);
    g.globalAlpha = 1;
  }
  g.font = `600 12px ${MONO}`;
  INSTRUMENTS.forEach((instrument, index) => {
    const y = top + index * rowHeight;
    const selected = instrument.voice === project.panel.selected;
    const quiet = project.mix.mutes[instrument.voice] ? 0.3 : 1;
    g.shadowBlur = 6;
    g.globalAlpha = (selected ? 1 : 0.55) * quiet;
    g.fillText(`${selected ? '▸' : ' '}${instrument.short}`, 36, y + 13);
    for (let step = 0; step < project.size; step += 1) {
      const on = isStepOn(shown.steps[instrument.voice], step);
      g.globalAlpha = (on ? 1 : 0.2) * quiet;
      g.shadowBlur = on ? 9 : 0;
      if (on) {
        g.fillRect(left + step * cell + 2, y + 2, cell - 4, rowHeight - 5);
      } else {
        g.strokeStyle = GREEN;
        g.lineWidth = 1;
        g.strokeRect(left + step * cell + 2.5, y + 2.5, cell - 5, rowHeight - 6);
      }
    }
  });
  g.globalAlpha = 1;
  g.shadowBlur = 6;
  for (let step = 0; step < project.size; step += 1) {
    if (isStepOn(shown.accents, step)) g.fillRect(left + step * cell + 5, top + VOICES.length * rowHeight + 3, cell - 10, 3);
  }

  g.font = `600 13px ${MONO}`;
  const resting = `${project.size === 16 ? '16 ПРЯМОЙ' : '12 ТРИОЛИ'}  ${EFFECT_NAMES[project.effect.kind]}${state.recording ? '  ● ЗАПИСЬ' : ''}`;
  g.fillText(state.line ?? resting, 48, 251);
}

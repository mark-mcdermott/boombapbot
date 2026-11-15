import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import {
  BPM_MAX,
  BPM_MIN,
  PANEL,
  PART_STEPS,
  SOUND_PARAM_LABELS,
  TRACKS,
  countSteps,
  getTrack,
  isStepOn,
  rhythmLength,
  tempoBpm,
  type PanelManifest,
  type PanelRect,
} from '@boombapbot/contracts';
import type { AssetManifest } from '../runtime';
import { editTarget } from '../state/store';
import { useEditorState, useRuntime } from './context';
import { Segmented } from './Segmented';

function useAssetManifest(): AssetManifest | null {
  const runtime = useRuntime();
  const [manifest, setManifest] = useState<AssetManifest | null>(null);
  useEffect(() => {
    let live = true;
    runtime
      .loadManifest()
      .then((loaded) => {
        if (live) setManifest(loaded);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [runtime]);
  return manifest;
}

/** Positions a faceplate rectangle as percentages, so it scales with the image. */
function box(panel: PanelManifest, [x, y, w, h]: PanelRect): CSSProperties {
  const { width, height } = panel.faceplate;
  return {
    left: `${(x / width) * 100}%`,
    top: `${(y / height) * 100}%`,
    width: `${(w / width) * 100}%`,
    height: `${(h / height) * 100}%`,
  };
}

function circle(panel: PanelManifest, cx: number, cy: number, r: number): CSSProperties {
  return box(panel, [cx - r, cy - r, r * 2, r * 2]);
}

/**
 * A knob cut from the faceplate photo: a round window onto the photo that
 * turns about the knob's centre. Without a photo it is drawn instead.
 */
function KnobFace(props: {
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
function knobLighting(panel: PanelManifest, photo: string | null): 'fixed' | undefined {
  return photo && panel.faceplate.original ? 'fixed' : undefined;
}

interface KnobProps {
  panel: PanelManifest;
  photo: string | null;
  geometry: { cx: number; cy: number; r: number; photoDeg: number; minDeg: number; maxDeg: number };
  label: string;
  testId: string;
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

/** A knob on the faceplate: drag up and down, or use the arrow keys. */
function Knob(props: KnobProps) {
  const { panel, photo, geometry, value, min, max, step, onChange } = props;
  const drag = useRef<{ y: number; value: number } | null>(null);
  const turn = (value - min) / (max - min);
  const deg = geometry.minDeg + turn * (geometry.maxDeg - geometry.minDeg);
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
  };

  return (
    <div
      className="sb-panel-knob"
      style={circle(panel, geometry.cx, geometry.cy, geometry.r)}
      role="slider"
      tabIndex={0}
      data-testid={props.testId}
      data-lighting={knobLighting(panel, photo)}
      aria-label={props.label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={props.valueText}
      onKeyDown={onKeyDown}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        drag.current = { y: event.clientY, value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        set(drag.current.value + (drag.current.y - event.clientY) * props.perPixel);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <KnobFace
        panel={panel}
        photo={photo}
        cx={geometry.cx}
        cy={geometry.cy}
        r={geometry.r}
        photoDeg={geometry.photoDeg}
        deg={deg}
      />
    </div>
  );
}

function TempoKnob({ panel, photo }: { panel: PanelManifest; photo: string | null }) {
  const { store } = useRuntime();
  const bpm = useEditorState((state) => Math.round(tempoBpm(state.project.tempo)));
  return (
    <Knob
      panel={panel}
      photo={photo}
      geometry={panel.tempo}
      label={`${panel.tempo.label || 'Tempo'} in beats per minute`}
      testId="panel-tempo"
      value={bpm}
      min={BPM_MIN}
      max={BPM_MAX}
      step={1}
      // Two pixels per beat per minute.
      perPixel={0.5}
      valueText={`${bpm} beats per minute`}
      onChange={(value) => store.setBpm(value)}
    />
  );
}

type PanelKnob = NonNullable<PanelManifest['knobs']>[number];

/** A tone, decay, tuning or snappy knob. Its travel reads as 0 to 100. */
function SoundKnob({ panel, photo, knob }: { panel: PanelManifest; photo: string | null; knob: PanelKnob }) {
  const { store } = useRuntime();
  const position = useEditorState((state) => state.project.sound.knobs[knob.track][knob.param]);
  const percent = Math.round(position * 100);
  return (
    <Knob
      panel={panel}
      photo={photo}
      geometry={knob}
      label={`${getTrack(knob.track).label} ${SOUND_PARAM_LABELS[knob.param]}`}
      testId={`panel-knob-${knob.track}-${knob.param}`}
      value={percent}
      min={0}
      max={100}
      step={2}
      // Its whole travel in 200 pixels.
      perPixel={0.5}
      valueText={`${percent}%`}
      onChange={(value) => store.setKnob(knob.track, knob.param, value / 100)}
    />
  );
}

export function HardwarePanel() {
  const runtime = useRuntime();
  const { store } = runtime;
  const target = useEditorState((state) => editTarget(state.project), sameTarget);
  const rhythm = useEditorState((state) => state.project.rhythms[editTarget(state.project).rhythm]!);
  const playing = useEditorState((state) => state.playing);
  const currentStep = useEditorState((state) => state.currentStep);
  const manifest = useAssetManifest();
  const [fit, setFit] = useState(false);
  // An image that fails to load falls back to the drawn panel.
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const panel = PANEL;
  const photoUrl = manifest?.faceplate ? runtime.assetUrl(manifest.faceplate) : null;
  const photo = photoUrl && photoUrl !== failedPhoto ? photoUrl : null;
  const track = getTrack(target.track);
  const row = rhythm[target.variation][target.track];
  const select = panel.voiceSelect;
  const activePosition = select.positions.find((position) => position.track === target.track);
  // The sixteen lamps show whichever part of the measure is playing.
  const lamp = playing && currentStep >= 0 ? currentStep % PART_STEPS : -1;
  const lampPart = currentStep >= PART_STEPS ? PART_STEPS : 0;
  const stepOn = (button: number) => isStepOn(row, target.offset + button);
  const selectTrack = (id: typeof target.track) => {
    store.selectTrack(id);
    void runtime.audition(id);
  };

  const focusStep = (step: number) =>
    panelRef.current?.querySelector<HTMLButtonElement>(`[data-panel-step="${step}"]`)?.focus();

  return (
    <section className="sb-hardware" aria-label={`${panel.name} drum machine`} data-testid="hardware">
      <div className="sb-panel-scroll" data-fit={fit}>
        <div
          ref={panelRef}
          className="sb-panel"
          data-drawn={!photo}
          data-testid="panel"
          data-photo={photo ? 'photo' : 'drawn'}
          style={
            {
              aspectRatio: `${panel.faceplate.width} / ${panel.faceplate.height}`,
              '--panel': panel.theme.panel,
              '--panel-ink': panel.theme.ink,
              '--panel-accent': panel.theme.accent,
              '--panel-button': panel.theme.button,
              '--panel-well': panel.theme.well,
              '--panel-led': panel.theme.led,
            } as CSSProperties
          }
        >
          {photo ? (
            <img
              className="sb-panel-photo"
              src={photo}
              alt=""
              draggable={false}
              onError={() => setFailedPhoto(photo)}
            />
          ) : (
            <>
              {panel.wells.map((well, i) => (
                <span key={i} className="sb-panel-well" style={box(panel, well)} />
              ))}
              <span className="sb-panel-title">{panel.name}</span>
              <span className="sb-panel-note">Drawn stand-in. This build has no faceplate image.</span>
            </>
          )}

          {!photo
            ? panel.steps.map((step, index) => (
                <span key={index} className="sb-panel-key" aria-hidden="true" style={box(panel, step.button)} />
              ))
            : null}

          <TempoKnob panel={panel} photo={photo} />
          {(panel.knobs ?? []).map((knob) => (
            <SoundKnob key={`${knob.track}-${knob.param}`} panel={panel} photo={photo} knob={knob} />
          ))}
          {!photo ? (
            <span
              className="sb-panel-caption"
              style={box(panel, [panel.tempo.cx - 60, panel.tempo.cy - panel.tempo.r - 26, 120, 18])}
            >
              {panel.tempo.label}
            </span>
          ) : null}

          {select.knob ? (
            <span
              className="sb-panel-knob sb-panel-knob-passive"
              data-lighting={knobLighting(panel, photo)}
              style={circle(panel, select.knob.cx, select.knob.cy, select.knob.r)}
              aria-hidden="true"
            >
              <KnobFace
                panel={panel}
                photo={photo}
                cx={select.knob.cx}
                cy={select.knob.cy}
                r={select.knob.r}
                photoDeg={select.knob.photoDeg}
                deg={activePosition?.deg ?? 0}
              />
            </span>
          ) : null}

          <div className="sb-panel-layer" role="radiogroup" aria-label={select.label || 'Instrument'}>
            {select.positions.map((position) => (
              <button
                key={position.track}
                type="button"
                role="radio"
                className="sb-panel-voice"
                style={box(panel, position.hit)}
                aria-checked={position.track === target.track}
                aria-label={`${position.label}, ${getTrack(position.track).label}`}
                data-testid={`panel-voice-${position.track}`}
                onClick={() => selectTrack(position.track)}
              >
                <span className="sb-panel-text">{position.label}</span>
              </button>
            ))}
          </div>

          {panel.transport.map((control) => (
            <button
              key={control.action}
              type="button"
              className="sb-panel-transport"
              style={box(panel, control.hit)}
              data-testid={`panel-${control.action}`}
              aria-label={control.label}
              aria-pressed={control.action === 'stop' ? undefined : playing}
              onClick={() => {
                if (control.action === 'toggle') void runtime.togglePlay();
                else if (control.action === 'start') void runtime.play();
                else runtime.stop();
              }}
            >
              <span className="sb-panel-text">{control.label}</span>
            </button>
          ))}

          <div className="sb-panel-layer" role="group" aria-label={`${track.label} steps`}>
            {panel.steps.map((step, index) => {
              const on = stepOn(index);
              return (
                <button
                  key={index}
                  type="button"
                  className="sb-panel-step"
                  style={box(panel, step.hit)}
                  data-panel-step={index}
                  data-on={on}
                  aria-pressed={on}
                  aria-label={`${track.label}, step ${index + 1}, ${on ? 'on' : 'off'}`}
                  onClick={() => {
                    if (store.toggleStep(index) && !store.getState().playing) runtime.auditionIfRunning(target.track);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight') {
                      event.preventDefault();
                      focusStep((index + 1) % PART_STEPS);
                    } else if (event.key === 'ArrowLeft') {
                      event.preventDefault();
                      focusStep((index - 1 + PART_STEPS) % PART_STEPS);
                    }
                  }}
                >
                  <span className="sb-panel-text">{index + 1}</span>
                </button>
              );
            })}
          </div>

          {panel.steps.map((step, index) => {
            const [x, y] = step.led;
            return (
              <span
                key={index}
                className="sb-panel-led"
                aria-hidden="true"
                data-on={stepOn(index)}
                data-now={lamp === index && lampPart === target.offset}
                data-dim={!photo || panel.ledsLitInPhoto}
                style={circle(panel, x, y, panel.ledRadius)}
              />
            );
          })}
        </div>
      </div>

      {/* On a phone the faceplate's own selector is too small to tap. */}
      <div className="sb-panel-touch">
        <Segmented
          label="Instrument"
          className="sb-segmented-fill sb-panel-strip"
          value={target.track}
          onChange={selectTrack}
          options={TRACKS.map((entry) => ({
            value: entry.id,
            label: entry.short,
            name: entry.label,
            testId: `strip-voice-${entry.id}`,
          }))}
        />
        <div className="sb-panel-info">
          <p data-testid="panel-voice">
            <span className="sb-label">Instrument</span> <strong>{track.label}</strong> ·{' '}
            {countSteps(row, rhythmLength(rhythm))} steps on
          </p>
          <button type="button" className="sb-button" aria-pressed={fit} onClick={() => setFit(!fit)}>
            {fit ? 'Zoom in' : 'Fit to screen'}
          </button>
        </div>
      </div>

      {photo && panel.faceplate.credit ? (
        <p className="sb-panel-meta" data-testid="panel-credit">
          Faceplate {panel.faceplate.credit.changes ? 'adapted from' : 'photo:'}{' '}
          <a href={panel.faceplate.credit.source} target="_blank" rel="noreferrer noopener">
            “{panel.faceplate.credit.title}”
          </a>{' '}
          by {panel.faceplate.credit.author}, licensed{' '}
          <a href={panel.faceplate.credit.licenceUrl} target="_blank" rel="noreferrer noopener">
            {panel.faceplate.credit.licence}
          </a>
          .{panel.faceplate.credit.changes ? ` ${panel.faceplate.credit.changes}` : ''}
        </p>
      ) : null}
    </section>
  );
}

/** What the panel does not model yet. Shown in settings. */
export function PanelNotes() {
  return (
    <details className="sb-panel-pending" data-testid="panel-pending">
      <summary>Prototype: what still needs checking against the hardware</summary>
      <ul>
        {PANEL.pending.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}

function sameTarget(a: ReturnType<typeof editTarget>, b: ReturnType<typeof editTarget>): boolean {
  return a.rhythm === b.rhythm && a.variation === b.variation && a.track === b.track && a.offset === b.offset;
}

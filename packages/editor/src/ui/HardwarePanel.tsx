import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import {
  BPM_MAX,
  BPM_MIN,
  KITS,
  STEP_COUNT,
  countHits,
  findLane,
  getPanel,
  panelRoles,
  rolesOutsidePanel,
  type PanelManifest,
  type PanelRect,
} from '@boombapbot/contracts';
import type { AssetManifest } from '../runtime';
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

function TempoKnob({ panel, photo }: { panel: PanelManifest; photo: string | null }) {
  const { store } = useRuntime();
  const bpm = useEditorState((state) => state.project.bpm);
  const drag = useRef<{ y: number; bpm: number } | null>(null);
  const { tempo } = panel;
  const deg = tempo.minDeg + ((bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)) * (tempo.maxDeg - tempo.minDeg);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = {
      ArrowUp: 1,
      ArrowRight: 1,
      ArrowDown: -1,
      ArrowLeft: -1,
      PageUp: 10,
      PageDown: -10,
    };
    const change = steps[event.key];
    if (change !== undefined) {
      event.preventDefault();
      store.setBpm(bpm + change);
    } else if (event.key === 'Home') {
      event.preventDefault();
      store.setBpm(BPM_MIN);
    } else if (event.key === 'End') {
      event.preventDefault();
      store.setBpm(BPM_MAX);
    }
  };

  return (
    <div
      className="sb-panel-knob"
      style={circle(panel, tempo.cx, tempo.cy, tempo.r)}
      role="slider"
      tabIndex={0}
      data-testid="panel-tempo"
      aria-label={`${tempo.label || 'Tempo'} in beats per minute`}
      aria-valuemin={BPM_MIN}
      aria-valuemax={BPM_MAX}
      aria-valuenow={bpm}
      onKeyDown={onKeyDown}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        drag.current = { y: event.clientY, bpm };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        // Drag up to speed up: two pixels per beat per minute.
        store.setBpm(drag.current.bpm + (drag.current.y - event.clientY) / 2);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <KnobFace panel={panel} photo={photo} cx={tempo.cx} cy={tempo.cy} r={tempo.r} photoDeg={tempo.photoDeg} deg={deg} />
    </div>
  );
}

export function HardwarePanel() {
  const runtime = useRuntime();
  const { store } = runtime;
  const kitId = useEditorState((state) => state.project.kit.id);
  const pattern = useEditorState((state) => state.project.pattern);
  const selectedRole = useEditorState((state) => state.selectedRole);
  const playing = useEditorState((state) => state.playing);
  const currentStep = useEditorState((state) => state.currentStep);
  const manifest = useAssetManifest();
  const [fit, setFit] = useState(false);
  // A photo that fails to load falls back to the drawn panel.
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const panel = getPanel(kitId);
  const kit = KITS[kitId];
  const photoPath = manifest?.faceplates[kitId];
  const photoUrl = photoPath ? runtime.assetUrl(photoPath) : null;
  const photo = photoUrl && photoUrl !== failedPhoto ? photoUrl : null;
  const roles = panelRoles(panel);
  // A lane chosen in Modern may not exist on this panel; fall back to the
  // panel's first voice without changing the shared selection.
  const activeRole = roles.includes(selectedRole) ? selectedRole : roles[0]!;
  const lane = findLane(pattern, activeRole);
  const voice = kit.voices[activeRole];
  const outside = rolesOutsidePanel(panel)
    .map((role) => ({ role, hits: findLane(pattern, role).steps.filter((v) => v > 0).length }))
    .filter((entry) => entry.hits > 0);
  const select = panel.voiceSelect;
  const activePosition = select.positions.find((position) => position.role === activeRole);

  const focusStep = (step: number) =>
    panelRef.current?.querySelector<HTMLButtonElement>(`[data-panel-step="${step}"]`)?.focus();

  return (
    <section className="sb-hardware" aria-label={`${panel.name} hardware editor`} data-testid="hardware">
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
              <span className="sb-panel-note">Drawn stand-in. The faceplate photo is not in this build.</span>
            </>
          )}

          {!photo
            ? panel.steps.map((step, index) => (
                <span key={index} className="sb-panel-key" aria-hidden="true" style={box(panel, step.button)} />
              ))
            : null}

          <TempoKnob panel={panel} photo={photo} />
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
            {select.positions.map((position) => {
              const role = position.role;
              const checked = role === activeRole;
              return (
                <button
                  key={position.label}
                  type="button"
                  role="radio"
                  className="sb-panel-voice"
                  style={box(panel, position.hit)}
                  aria-checked={checked}
                  aria-label={
                    role
                      ? `${position.label}, ${kit.voices[role].label}`
                      : `${position.label}, not available in this prototype`
                  }
                  disabled={!role}
                  data-testid={role ? `panel-voice-${role}` : undefined}
                  onClick={() => {
                    if (!role) return;
                    store.select(role);
                    void runtime.audition(role);
                  }}
                >
                  <span className="sb-panel-text">{position.label}</span>
                </button>
              );
            })}
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

          <div className="sb-panel-layer" role="group" aria-label={`${voice.label} steps`}>
            {panel.steps.map((step, index) => {
              const velocity = lane.steps[index] ?? 0;
              return (
                <button
                  key={index}
                  type="button"
                  className="sb-panel-step"
                  style={box(panel, step.hit)}
                  data-panel-step={index}
                  data-on={velocity > 0}
                  aria-pressed={velocity > 0}
                  aria-label={`${voice.label}, step ${index + 1}, ${velocity > 0 ? `on, velocity ${velocity}` : 'off'}`}
                  onClick={() => {
                    store.select(activeRole, index);
                    const next = store.toggleStep(activeRole, index);
                    if (next > 0 && !store.getState().playing) runtime.auditionIfRunning(activeRole, next);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight') {
                      event.preventDefault();
                      focusStep((index + 1) % STEP_COUNT);
                    } else if (event.key === 'ArrowLeft') {
                      event.preventDefault();
                      focusStep((index - 1 + STEP_COUNT) % STEP_COUNT);
                    }
                  }}
                >
                  <span className="sb-panel-text">{index + 1}</span>
                </button>
              );
            })}
          </div>

          {panel.steps.map((step, index) => {
            const velocity = lane.steps[index] ?? 0;
            const [x, y] = step.led;
            return (
              <span
                key={index}
                className="sb-panel-led"
                aria-hidden="true"
                data-on={velocity > 0}
                data-now={playing && currentStep === index}
                data-dim={!photo || panel.ledsLitInPhoto}
                style={circle(panel, x, y, panel.ledRadius)}
              />
            );
          })}
        </div>
      </div>

      <Segmented
        label="Instrument"
        className="sb-panel-strip"
        value={activeRole}
        onChange={(role) => {
          store.select(role);
          void runtime.audition(role);
        }}
        options={roles.map((role) => ({
          value: role,
          label: kit.voices[role].short,
          name: kit.voices[role].label,
          testId: `strip-voice-${role}`,
        }))}
      />

      <div className="sb-panel-info">
        <p data-testid="panel-voice">
          <span className="sb-label">Instrument</span> <strong>{voice.label}</strong> · {countHits({ ...pattern, lanes: [lane] })} steps on
        </p>
        <button type="button" className="sb-button sb-panel-fit" aria-pressed={fit} onClick={() => setFit(!fit)}>
          {fit ? 'Zoom in' : 'Fit to screen'}
        </button>
      </div>

      {outside.length > 0 ? (
        <p className="sb-panel-outside" data-testid="panel-outside">
          This beat also has hits this panel cannot show:{' '}
          {outside.map((entry) => `${kit.voices[entry.role].label} (${entry.hits})`).join(', ')}. They keep playing
          and stay in the beat.{' '}
          <button type="button" className="sb-link" onClick={() => store.setMode('modern')}>
            Edit them in Modern
          </button>
        </p>
      ) : null}

      <details className="sb-panel-pending">
        <summary>Prototype: what still needs checking against the hardware</summary>
        <ul>
          {panel.pending.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          {photo
            ? 'Showing a faceplate photo from your local misc/assets folder. It is not part of the repository or of production builds.'
            : 'Showing a drawn panel. To use a faceplate photo locally, put it in misc/assets and run pnpm dev.'}
        </p>
      </details>
    </section>
  );
}

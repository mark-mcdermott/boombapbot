import { useRef, type KeyboardEvent } from 'react';
import {
  ACCENT_VELOCITY,
  KITS,
  STEP_COUNT,
  type Lane,
  type RoleId,
} from '@boombapbot/contracts';
import { useEditorState, useRuntime } from './context';
import { PlayButton } from './Transport';

const BEATS = [0, 1, 2, 3];
const VELOCITY_NUDGE = 8;

function stepLabel(voice: string, step: number, velocity: number): string {
  const state = velocity > 0 ? `on, velocity ${velocity}` : 'off';
  return `${voice}, step ${step + 1}, ${state}`;
}

export function StepGrid() {
  const runtime = useRuntime();
  const { store } = runtime;
  const lanes = useEditorState((state) => state.project.pattern.lanes);
  const kitId = useEditorState((state) => state.project.kit.id);
  const selectedRole = useEditorState((state) => state.selectedRole);
  const selectedStep = useEditorState((state) => state.selectedStep);
  const currentStep = useEditorState((state) => state.currentStep);
  const playing = useEditorState((state) => state.playing);
  const gridRef = useRef<HTMLElement>(null);
  const kit = KITS[kitId];

  const focusStep = (role: RoleId, step: number) => {
    store.select(role, step);
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-role="${role}"][data-step="${step}"]`)
      ?.focus();
  };

  const toggle = (role: RoleId, step: number) => {
    store.select(role, step);
    const velocity = store.toggleStep(role, step);
    // Hear the hit you just placed, unless the beat is already playing it.
    if (velocity > 0 && !store.getState().playing) runtime.auditionIfRunning(role, velocity);
  };

  const onStepKeyDown = (event: KeyboardEvent<HTMLButtonElement>, lane: Lane, step: number) => {
    const laneIndex = lanes.findIndex((candidate) => candidate.id === lane.id);
    const velocity = lane.steps[step] ?? 0;
    const move = (role: RoleId, target: number) => {
      event.preventDefault();
      focusStep(role, target);
    };
    switch (event.key) {
      case 'ArrowRight':
        return move(lane.role, (step + 1) % STEP_COUNT);
      case 'ArrowLeft':
        return move(lane.role, (step - 1 + STEP_COUNT) % STEP_COUNT);
      case 'ArrowDown': {
        const next = lanes[Math.min(lanes.length - 1, laneIndex + 1)];
        return next ? move(next.role, step) : undefined;
      }
      case 'ArrowUp': {
        const previous = lanes[Math.max(0, laneIndex - 1)];
        return previous ? move(previous.role, step) : undefined;
      }
      case 'Home':
        return move(lane.role, 0);
      case 'End':
        return move(lane.role, STEP_COUNT - 1);
      case '=':
      case '+':
        event.preventDefault();
        return store.setVelocity(lane.role, step, (velocity || 0) + VELOCITY_NUDGE, true);
      case '-':
      case '_':
        event.preventDefault();
        // Stop at 1 so the quietest hit stays on; Space turns a step off.
        return velocity > 0
          ? store.setVelocity(lane.role, step, Math.max(1, velocity - VELOCITY_NUDGE), true)
          : undefined;
      case 'a':
      case 'A':
        event.preventDefault();
        return store.setVelocity(lane.role, step, ACCENT_VELOCITY);
      default:
        return undefined;
    }
  };

  return (
    <section
      ref={gridRef}
      className="sb-grid"
      aria-label="Step grid"
      data-testid="grid"
      data-playhead={playing ? currentStep : -1}
    >
      <div className="sb-grid-ruler">
        <PlayButton className="sb-grid-play" testId="play" />
        <div className="sb-steps" aria-hidden="true">
          {BEATS.map((beat) => (
            <div className="sb-beat" key={beat}>
              {[0, 1, 2, 3].map((offset) => (
                <span key={offset} data-step={beat * 4 + offset} className="sb-ruler-mark">
                  {beat * 4 + offset + 1}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {lanes.map((lane) => {
        const voice = kit.voices[lane.role];
        const selected = lane.role === selectedRole;
        return (
          <div
            key={lane.id}
            className="sb-lane"
            data-selected={selected}
            data-testid={`lane-${lane.role}`}
          >
            <div className="sb-lane-head">
              <button
                type="button"
                className="sb-pad"
                data-testid={`audition-${lane.role}`}
                aria-label={`${voice.short}, audition ${voice.label}`}
                onClick={() => {
                  store.select(lane.role);
                  void runtime.audition(lane.role);
                }}
              >
                {voice.short}
              </button>
              <button
                type="button"
                className="sb-lane-name"
                aria-pressed={selected}
                aria-label={`Select ${voice.label} lane`}
                onClick={() => store.select(lane.role)}
              >
                <span className="sb-lane-label">{voice.label}</span>
                {voice.substitute ? (
                  <span className="sb-badge" title={voice.substitute.reason}>
                    stand-in
                  </span>
                ) : null}
              </button>
            </div>
            <div className="sb-steps" role="group" aria-label={`${voice.label} steps`}>
              {BEATS.map((beat) => (
                <div className="sb-beat" key={beat}>
                  {[0, 1, 2, 3].map((offset) => {
                    const step = beat * 4 + offset;
                    const velocity = lane.steps[step] ?? 0;
                    return (
                      <button
                        key={step}
                        type="button"
                        className="sb-step"
                        data-role={lane.role}
                        data-step={step}
                        data-on={velocity > 0}
                        data-accent={velocity >= 120}
                        data-velocity={velocity}
                        style={{ '--v': velocity / 127 } as React.CSSProperties}
                        aria-pressed={velocity > 0}
                        aria-label={stepLabel(voice.label, step, velocity)}
                        tabIndex={selected && step === selectedStep ? 0 : -1}
                        onClick={() => toggle(lane.role, step)}
                        onFocus={() => store.select(lane.role, step)}
                        onKeyDown={(event) => onStepKeyDown(event, lane, step)}
                      >
                        <span className="sb-step-fill" />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { DEFAULT_VELOCITY, KITS, VELOCITY_MAX, findLane } from '@boombapbot/contracts';
import { useEditorState, useRuntime } from './context';

/** Velocity bars for the selected lane. Drag across them to shape the groove. */
export function VelocityLane() {
  const { store } = useRuntime();
  const role = useEditorState((state) => state.selectedRole);
  const selectedStep = useEditorState((state) => state.selectedStep);
  const pattern = useEditorState((state) => state.project.pattern);
  const kitId = useEditorState((state) => state.project.kit.id);
  const barsRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lane = findLane(pattern, role);
  const voice = KITS[kitId].voices[role];

  const applyPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bars = barsRef.current?.querySelectorAll<HTMLElement>('[data-bar]');
    if (!bars) return;
    for (const bar of bars) {
      const rect = bar.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right) continue;
      const ratio = 1 - (event.clientY - rect.top) / rect.height;
      const velocity = Math.round(Math.min(1, Math.max(0, ratio)) * VELOCITY_MAX);
      const step = Number(bar.dataset.bar);
      store.select(role, step);
      store.setVelocity(role, step, velocity, true);
      return;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, step: number, velocity: number) => {
    const change = (next: number) => {
      event.preventDefault();
      store.setVelocity(role, step, next, true);
    };
    const focus = (target: number) => {
      event.preventDefault();
      barsRef.current?.querySelector<HTMLElement>(`[data-bar="${target}"]`)?.focus();
    };
    switch (event.key) {
      case 'ArrowUp':
        return change(velocity + 4);
      case 'ArrowDown':
        return change(velocity - 4);
      case 'PageUp':
        return change(velocity + 16);
      case 'PageDown':
        return change(velocity - 16);
      case 'Home':
        return change(0);
      case 'End':
        return change(VELOCITY_MAX);
      case 'ArrowRight':
        return focus(Math.min(lane.steps.length - 1, step + 1));
      case 'ArrowLeft':
        return focus(Math.max(0, step - 1));
      case 'Enter':
      case ' ':
        return change(velocity > 0 ? 0 : DEFAULT_VELOCITY);
      default:
        return undefined;
    }
  };

  const selectedVelocity = lane.steps[selectedStep] ?? 0;

  return (
    <section className="sb-velocity" aria-label={`${voice.label} velocity`} data-testid="velocity">
      <div className="sb-label-row">
        <span className="sb-label">
          Velocity <span className="sb-label-strong">{voice.label}</span>
        </span>
        <output className="sb-readout" data-testid="velocity-readout">
          Step {selectedStep + 1}: {selectedVelocity > 0 ? selectedVelocity : 'off'}
        </output>
      </div>
      <div
        ref={barsRef}
        className="sb-vel-bars"
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          applyPointer(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) applyPointer(event);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        {lane.steps.map((velocity, step) => (
          <div
            key={step}
            role="slider"
            tabIndex={0}
            className="sb-vel-bar"
            data-bar={step}
            data-selected={step === selectedStep}
            data-beat={step % 4 === 0}
            aria-label={`Step ${step + 1} velocity`}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={VELOCITY_MAX}
            aria-valuenow={velocity}
            aria-valuetext={velocity > 0 ? String(velocity) : 'off'}
            onFocus={() => store.select(role, step)}
            onKeyDown={(event) => onKeyDown(event, step, velocity)}
          >
            <span className="sb-vel-fill" style={{ height: `${(velocity / VELOCITY_MAX) * 100}%` }} />
          </div>
        ))}
      </div>
    </section>
  );
}

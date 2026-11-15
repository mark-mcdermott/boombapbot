import { Slider } from '@base-ui/react/slider';
import { useEffect, useState } from 'react';
import { BPM_MAX, BPM_MIN, SWING_MAX, SWING_MIN } from '@boombapbot/contracts';
import { useEditorState, useRuntime } from './context';
import { PlayIcon, StopIcon } from './icons';

function RangeSlider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(value: number): void;
  testId?: string;
}) {
  return (
    <Slider.Root
      value={props.value}
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      onValueChange={(value) => props.onChange(value as number)}
      className="sb-slider"
    >
      <Slider.Control className="sb-slider-control">
        <Slider.Track className="sb-slider-track">
          <Slider.Indicator className="sb-slider-fill" />
          <Slider.Thumb className="sb-slider-thumb" aria-label={props.label} data-testid={props.testId} />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}

function BpmField() {
  const runtime = useRuntime();
  const bpm = useEditorState((state) => state.project.bpm);
  const [text, setText] = useState(String(bpm));
  useEffect(() => setText(String(bpm)), [bpm]);

  const commit = (value: string) => {
    const parsed = Number(value);
    if (value.trim() !== '' && Number.isFinite(parsed)) runtime.store.setBpm(parsed);
    setText(String(runtime.store.getState().project.bpm));
  };

  return (
    <div className="sb-field">
      <label className="sb-label" htmlFor="sb-bpm">
        Tempo
      </label>
      <div className="sb-stepper">
        <button
          type="button"
          className="sb-stepper-button"
          aria-label="Slower"
          onClick={() => runtime.store.setBpm(bpm - 1)}
        >
          −
        </button>
        <input
          id="sb-bpm"
          className="sb-number"
          data-testid="bpm"
          inputMode="numeric"
          type="number"
          min={BPM_MIN}
          max={BPM_MAX}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            const parsed = Number(event.target.value);
            // Apply as the user types once the value is a usable tempo.
            if (parsed >= BPM_MIN && parsed <= BPM_MAX) runtime.store.setBpm(parsed);
          }}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(event.currentTarget.value);
          }}
        />
        <span className="sb-unit" aria-hidden="true">
          BPM
        </span>
        <button
          type="button"
          className="sb-stepper-button"
          aria-label="Faster"
          onClick={() => runtime.store.setBpm(bpm + 1)}
        >
          +
        </button>
      </div>
      <RangeSlider
        label="Tempo in beats per minute"
        value={bpm}
        min={BPM_MIN}
        max={BPM_MAX}
        onChange={(value) => runtime.store.setBpm(value)}
      />
    </div>
  );
}

function SwingField() {
  const runtime = useRuntime();
  const swing = useEditorState((state) => state.project.swing);
  return (
    <div className="sb-field">
      <div className="sb-label-row">
        <span className="sb-label">Swing</span>
        <output className="sb-readout" data-testid="swing-value">
          {swing}%
        </output>
      </div>
      <RangeSlider
        label="Swing percent"
        value={swing}
        min={SWING_MIN}
        max={SWING_MAX}
        onChange={(value) => runtime.store.setSwing(value)}
        testId="swing"
      />
      <span className="sb-hint">{swing === 50 ? 'Straight' : swing >= 66 ? 'Triplet feel' : 'Light shuffle'}</span>
    </div>
  );
}

/** Starts and stops the beat. The machine carries it; phones also dock one. */
export function PlayButton({ className = '', testId }: { className?: string; testId: string }) {
  const runtime = useRuntime();
  const playing = useEditorState((state) => state.playing);
  const starting = useEditorState((state) => state.audioStatus === 'starting');

  return (
    <button
      type="button"
      className={`sb-play ${className}`}
      data-testid={testId}
      data-playing={playing}
      aria-pressed={playing}
      aria-busy={starting}
      onClick={() => void runtime.togglePlay()}
    >
      {playing ? <StopIcon /> : <PlayIcon />}
      <span>{playing ? 'Stop' : starting ? 'Starting' : 'Play'}</span>
    </button>
  );
}

export function Transport() {
  return (
    <section className="sb-transport" aria-label="Tempo and swing">
      <BpmField />
      <SwingField />
    </section>
  );
}

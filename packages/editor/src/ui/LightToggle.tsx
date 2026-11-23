import { Moon, Sun } from 'lucide-react';
import type { RefObject } from 'react';
import type { MachineLight } from '../machine';
import { Tip } from './Tip';

interface LightToggleProps {
  light: MachineLight;
  /** Where the tip mounts, so it inherits the page's theme. */
  container: RefObject<HTMLElement | null>;
}

/**
 * The switch between the machine seen in the light and in the dark, in the
 * footer beside the settings. Its icon is the light it is in now, a sun or a
 * moon, on a phone too, where the footer's other buttons are words. Its name
 * is that light and what pressing it does.
 */
export function LightToggle({ light, container }: LightToggleProps) {
  const now = light.use();
  const next = now === 'light' ? 'dark' : 'light';
  const word = now === 'light' ? 'Light' : 'Dark';
  const press = `Switch to ${next} mode`;
  return (
    <Tip label={press} container={container}>
      <button
        type="button"
        className="sb-footer-icon sb-ico-light"
        data-testid="light-toggle"
        data-light={now}
        aria-label={`${word} mode, ${press.toLowerCase()}`}
        onClick={() => light.set(next)}
      >
        {now === 'light' ? <Sun /> : <Moon />}
        <span className="sb-footer-word">{word}</span>
      </button>
    </Tip>
  );
}

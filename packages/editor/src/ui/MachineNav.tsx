import type { ReactNode } from 'react';

/**
 * The four machines as small drawings, each in its own colours and layout.
 * They are original artwork made for boombapbot, like the faceplate.
 */

const VIEW = '0 0 48 30';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="sb-machine-icon" viewBox={VIEW} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** A row of evenly spaced keys or knobs. */
function row(count: number, from: number, to: number, draw: (x: number, index: number) => ReactNode): ReactNode[] {
  return Array.from({ length: count }, (_, index) => draw(from + ((to - from) * index) / (count - 1), index));
}

/** Small and silver: a row of knobs over a row of pale keys with red lamps. */
function Icon606() {
  return (
    <Icon>
      <rect x="1" y="5" width="46" height="20" rx="2.5" fill="#cfd3d8" />
      <rect x="1" y="5" width="46" height="7.5" rx="2.5" fill="#b9bec5" />
      {row(8, 7, 41, (x, i) => (
        <circle key={`k${i}`} cx={x} cy="9" r="1.6" fill="#2b2d31" />
      ))}
      {row(8, 7, 41, (x, i) => (
        <g key={`s${i}`}>
          <rect x={x - 1.9} y="16" width="3.8" height="6" rx="0.6" fill="#f4f5f6" stroke="#8d939b" strokeWidth="0.4" />
          <circle cx={x} cy="14.6" r="0.6" fill="#e0372b" />
        </g>
      ))}
    </Icon>
  );
}

/** Cream, with a dark display on the left and a bank of faders on the right. */
function Icon707() {
  return (
    <Icon>
      <rect x="1" y="2" width="46" height="26" rx="2.5" fill="#e6e2d6" />
      <rect x="4" y="5" width="15" height="9" rx="1" fill="#33403a" />
      {row(4, 6.5, 16.5, (x, i) => (
        <rect key={`d${i}`} x={x - 0.9} y="7" width="1.8" height="5" fill="#6f8a78" />
      ))}
      {row(7, 24, 43, (x, i) => (
        <g key={`f${i}`}>
          <rect x={x - 0.25} y="5" width="0.5" height="9" fill="#8a867a" />
          <rect x={x - 1.1} y={6 + ((i * 3) % 5)} width="2.2" height="1.8" rx="0.4" fill="#4a4b4f" />
        </g>
      ))}
      {row(8, 6.5, 41.5, (x, i) => (
        <rect key={`s${i}`} x={x - 1.9} y="18" width="3.8" height="6.5" rx="0.6" fill={i % 4 === 0 ? '#f08a2c' : '#9a9a96'} />
      ))}
    </Icon>
  );
}

/** Dark, with orange knobs and keys that run red, orange, yellow and white. */
function Icon808() {
  const keys = ['#e7422d', '#f28b3a', '#f1d646', '#f2efe7'];
  return (
    <Icon>
      <rect x="1" y="2" width="46" height="26" rx="2.5" fill="#2b2c30" />
      <circle cx="8" cy="11" r="4.2" fill="#8d8a84" />
      <circle cx="8" cy="11" r="2.9" fill="#141518" />
      {row(8, 17, 43, (x, i) => (
        <circle key={`k${i}`} cx={x} cy="8" r="1.5" fill="#f7a53a" />
      ))}
      <rect x="15" y="13.2" width="30" height="0.7" fill="#ff5a2a" />
      <rect x="3" y="17.5" width="42" height="8.5" rx="1" fill="#8d8a84" />
      {row(16, 6.2, 41.8, (x, i) => (
        <rect key={`s${i}`} x={x - 1} y="19" width="2" height="5.5" rx="0.4" fill={keys[Math.floor(i / 4)]} />
      ))}
    </Icon>
  );
}

/** Pale grey under a darker band of knobs, with orange where the hand goes first. */
function Icon909() {
  return (
    <Icon>
      <rect x="1" y="2" width="46" height="26" rx="2.5" fill="#dcdcd8" />
      <rect x="1" y="2" width="46" height="11" rx="2.5" fill="#9a9da1" />
      <rect x="1" y="9" width="46" height="4" fill="#9a9da1" />
      {row(9, 6, 42, (x, i) => (
        <circle key={`k${i}`} cx={x} cy="7.5" r="1.7" fill="#3a3c40" />
      ))}
      <rect x="4" y="16" width="6" height="9" rx="0.8" fill="#f07a24" />
      {row(8, 15, 43, (x, i) => (
        <rect key={`s${i}`} x={x - 1.6} y="17.5" width="3.2" height="7.5" rx="0.6" fill={i % 4 === 0 ? '#f4f4f1' : '#b7b8b4'} stroke="#8f908c" strokeWidth="0.3" />
      ))}
    </Icon>
  );
}

const MACHINES = [
  { id: '606', icon: <Icon606 />, built: false },
  { id: '707', icon: <Icon707 />, built: false },
  { id: '808', icon: <Icon808 />, built: true },
  { id: '909', icon: <Icon909 />, built: false },
] as const;

export type MachineId = (typeof MACHINES)[number]['id'];

interface MachineNavProps {
  /** Base URL the site is served from, ending in a slash. */
  baseUrl: string;
  /** The machine on the page, if the page is one. */
  current?: MachineId;
}

/** The machines, top right. Only the 808 is built; the others say so and go nowhere. */
export function MachineNav({ baseUrl, current }: MachineNavProps) {
  return (
    <nav className="sb-machines" aria-label="Machines">
      <ul>
        {MACHINES.map((machine) => (
          <li key={machine.id}>
            {machine.built ? (
              <a
                className="sb-machine"
                href={baseUrl}
                data-testid={`machine-${machine.id}`}
                aria-current={current === machine.id ? 'page' : undefined}
              >
                {machine.icon}
                <span>{machine.id}</span>
              </a>
            ) : (
              <span className="sb-machine" data-testid={`machine-${machine.id}`} aria-disabled="true" title="Not built yet">
                {machine.icon}
                <span>{machine.id}</span>
                <span className="sb-visually-hidden">, not built yet</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

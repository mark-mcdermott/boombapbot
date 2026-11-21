import { useEffect, useState, type ReactElement } from 'react';
import { robotOf, type Robot } from '../account/default-avatar';
import type { SignedInAccount } from '../account/session';

const INK = '#1a1512';

const ANTENNAS: Record<Robot['antenna'], ReactElement> = {
  ball: (
    <>
      <path d="M16 9.5V6" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="16" cy="5" r="1.7" fill={INK} />
    </>
  ),
  twin: <path d="M12.5 9.5 11 5.6M19.5 9.5 21 5.6" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />,
  cap: <rect x="12" y="6.4" width="8" height="3.4" rx="1.4" fill={INK} />,
};

const EYES: Record<Robot['eyes'], ReactElement> = {
  round: (
    <>
      <circle cx="12.6" cy="15.4" r="2" />
      <circle cx="19.4" cy="15.4" r="2" />
    </>
  ),
  square: (
    <>
      <rect x="10.8" y="13.7" width="3.5" height="3.5" rx="0.8" />
      <rect x="17.7" y="13.7" width="3.5" height="3.5" rx="0.8" />
    </>
  ),
  visor: <rect x="10.4" y="13.8" width="11.2" height="3.2" rx="1.6" />,
};

const MOUTHS: Record<Robot['mouth'], string> = {
  line: 'M12.8 20.2h6.4',
  grille: 'M13 19.2v2M16 19.2v2M19 19.2v2',
  smile: 'M12.8 19.6q3.2 2.4 6.4 0',
};

/** The robot's face an account has for a picture until it uploads one. */
function RobotFace({ robot }: { robot: Robot }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" fill={robot.ground} />
      {ANTENNAS[robot.antenna]}
      <rect x="5.4" y="14" width="2.2" height="5" rx="1" fill={INK} />
      <rect x="24.4" y="14" width="2.2" height="5" rx="1" fill={INK} />
      <rect x="8" y="9.5" width="16" height="14" rx="4.2" fill={INK} />
      <g fill={robot.ground}>{EYES[robot.eyes]}</g>
      <path d={MOUTHS[robot.mouth]} fill="none" stroke={robot.ground} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

interface AvatarProps {
  account: SignedInAccount;
  /** Base URL of the site that serves the picture, ending in a slash. */
  baseUrl: string;
  /** Its side, in pixels. */
  size: number;
}

/**
 * An account's picture, round: the one it uploaded, or its robot until it
 * has. A picture that will not load gives way to the robot. It says
 * nothing to a screen reader: what it sits in names the account.
 */
export function Avatar({ account, baseUrl, size }: AvatarProps) {
  const [broken, setBroken] = useState<string | null>(null);
  const { image } = account;
  useEffect(() => setBroken(null), [image]);
  const uploaded = image !== null && image !== broken;
  return (
    <span className="sb-avatar" data-testid="avatar" data-kind={uploaded ? 'uploaded' : 'robot'} style={{ width: size, height: size }}>
      {uploaded ? (
        <img src={`${baseUrl}${image.slice(1)}`} alt="" width={size} height={size} onError={() => setBroken(image)} />
      ) : (
        <RobotFace robot={robotOf(account.id)} />
      )}
    </span>
  );
}

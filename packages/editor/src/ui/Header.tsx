import { Brand, TAGLINE } from './Brand';
import { MachineNav, type MachineId } from './MachineNav';

interface HeaderProps {
  /** Base URL the site is served from, ending in a slash. */
  baseUrl: string;
  current?: MachineId;
}

/** The machines are not shown for now; the owner asked for the header to be the brand alone. */
const SHOW_MACHINES = false;

/** The top of every page: the brand on the left, and the machines on the right when they are shown. */
export function Header({ baseUrl, current }: HeaderProps) {
  return (
    <header className="sb-header">
      <a className="sb-brand-link" href={baseUrl} aria-label={`boombapbot home, ${TAGLINE}`}>
        <Brand />
      </a>
      {SHOW_MACHINES && <MachineNav baseUrl={baseUrl} current={current} />}
    </header>
  );
}

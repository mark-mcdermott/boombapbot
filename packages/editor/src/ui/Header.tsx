import { Brand } from './Brand';
import { MachineNav, type MachineId } from './MachineNav';

interface HeaderProps {
  /** Base URL the site is served from, ending in a slash. */
  baseUrl: string;
  current?: MachineId;
}

/** The top of every page: the brand on the left, the machines on the right. */
export function Header({ baseUrl, current }: HeaderProps) {
  return (
    <header className="sb-header">
      <a className="sb-brand-link" href={baseUrl} aria-label="boombapbot home, Let me cook">
        <Brand />
      </a>
      <MachineNav baseUrl={baseUrl} current={current} />
    </header>
  );
}

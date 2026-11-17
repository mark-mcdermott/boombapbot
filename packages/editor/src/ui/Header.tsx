import { Brand, TAGLINE } from './Brand';

interface HeaderProps {
  /** Base URL the site is served from, ending in a slash. */
  baseUrl: string;
}

/** The top of every page: the brand alone. */
export function Header({ baseUrl }: HeaderProps) {
  return (
    <header className="sb-header">
      <a className="sb-brand-link" href={baseUrl} aria-label={`boombapbot home, ${TAGLINE}`}>
        <Brand />
      </a>
    </header>
  );
}

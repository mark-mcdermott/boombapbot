import type { ReactNode } from 'react';
import { Brand, TAGLINE } from './Brand';

interface HeaderProps {
  /** Base URL the site is served from, ending in a slash. */
  baseUrl: string;
  /**
   * What sits beside the brand. With it the header is the compact masthead of
   * a page of words; without it, the brand alone at full size.
   */
  children?: ReactNode;
}

/** The top of every page: the brand, and on a page of words the pages by name. */
export function Header({ baseUrl, children }: HeaderProps) {
  return (
    <header className={children ? 'sb-header sb-masthead' : 'sb-header'}>
      <a className="sb-brand-link" href={baseUrl} aria-label={`boombapbot home, ${TAGLINE}`}>
        <Brand />
      </a>
      {children}
    </header>
  );
}

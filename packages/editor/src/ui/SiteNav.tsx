import { SITE_PAGES, type SitePageId } from './pages';

interface SiteNavProps {
  /** Base URL the site is served from, ending in a slash. */
  baseUrl: string;
  current: SitePageId;
}

/**
 * The pages by name, beside the brand on a page of words. Each has a lamp
 * like the ones beside the machine's instrument keys, lit for the page that
 * is open.
 */
export function SiteNav({ baseUrl, current }: SiteNavProps) {
  return (
    <nav className="sb-nav" aria-label="Pages" data-testid="site-nav">
      <a className="sb-nav-link" href={baseUrl} data-testid="top-machine">
        Machine
      </a>
      {SITE_PAGES.map(({ id, label }) => (
        <a
          key={id}
          className="sb-nav-link"
          href={`${baseUrl}${id}`}
          data-testid={`top-${id}`}
          aria-current={current === id ? 'page' : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

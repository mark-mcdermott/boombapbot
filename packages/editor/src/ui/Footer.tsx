import { BookOpen, Heart, Info, Scale, ScrollText } from 'lucide-react';
import { useState, type ReactNode, type RefObject } from 'react';
import { Account } from './Account';
import { SITE_PAGES, type ListedPageId, type SitePageId } from './pages';
import { Shop } from './Shop';
import { Tip, TipGroup } from './Tip';
import { Upgrade } from './Upgrade';

const PAGE_ICONS: Record<ListedPageId, ReactNode> = {
  about: <Info />,
  docs: <BookOpen />,
  manifesto: <ScrollText />,
  policies: <Scale />,
};

interface FooterProps {
  /** Base URL the site is served from, ending in a slash. */
  baseUrl: string;
  /** Where modals mount, so they inherit the page's theme. */
  container: RefObject<HTMLElement | null>;
  /** The page this footer is on, if it is one the footer links to. */
  current?: SitePageId;
  /** The settings button. Only the machine's page has settings. */
  settings?: ReactNode;
}

/**
 * The row under every page: who made it, then the pages (about, docs,
 * manifesto, policies) and the buttons (upgrade, cart, settings,
 * account).
 */
export function Footer({ baseUrl, container, current, settings }: FooterProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  return (
    <footer className="sb-footer">
      <p className="sb-made" data-testid="made-by">
        built with <Heart className="sb-heart" role="img" aria-label="love" /> by{' '}
        <a href="https://mm.coffee" target="_blank" rel="noreferrer noopener">
          mm.coffee
        </a>
      </p>
      <TipGroup>
        <nav className="sb-footer-icons sb-footer-pages" aria-label="Site">
          {SITE_PAGES.map(({ id, label }) => (
            <Tip key={id} label={label} container={container}>
              <a
                className={`sb-footer-icon sb-ico-${id}`}
                href={`${baseUrl}${id}`}
                data-testid={`nav-${id}`}
                aria-label={label}
                aria-current={current === id ? 'page' : undefined}
              >
                {PAGE_ICONS[id]}
              </a>
            </Tip>
          ))}
        </nav>
        <div className="sb-footer-icons sb-footer-tools">
          <Upgrade baseUrl={baseUrl} container={container} logIn={() => setAccountOpen(true)} />
          <Shop baseUrl={baseUrl} container={container} />
          {settings}
          <Account baseUrl={baseUrl} container={container} open={accountOpen} setOpen={setAccountOpen} />
        </div>
      </TipGroup>
    </footer>
  );
}

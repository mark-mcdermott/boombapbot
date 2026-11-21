import { BookOpen, Heart, Info, Scale, ScrollText } from 'lucide-react';
import { useState, type ReactNode, type RefObject } from 'react';
import { Account } from './Account';
import { SITE_PAGES, type SitePageId } from './pages';
import { Shop } from './Shop';
import { Tip, TipGroup } from './Tip';
import { Upgrade } from './Upgrade';

const PAGE_ICONS: Record<SitePageId, ReactNode> = {
  about: <Info />,
  docs: <BookOpen />,
  manifesto: <ScrollText />,
  policies: <Scale />,
};

interface FooterPagesProps {
  /** What a page's address starts with, ending in a slash. */
  baseUrl: string;
  /** Where the tips mount, so they inherit the page's theme. */
  container: RefObject<HTMLElement | null>;
  /** The page these links are on, if it is one of them. */
  current?: SitePageId;
}

/** The links to the pages of words, each an icon with its name in a tip, or on a phone its name. */
export function FooterPages({ baseUrl, container, current }: FooterPagesProps) {
  return (
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
            <span className="sb-footer-word">{label}</span>
          </a>
        </Tip>
      ))}
    </nav>
  );
}

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
 * account). Each is an icon with its name in a tip. On a phone, where
 * there is no pointing at an icon to learn its name, each is its name in
 * words, in a row of their own above the credit.
 */
export function Footer({ baseUrl, container, current, settings }: FooterProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  return (
    <footer className="sb-footer">
      <p className="sb-made" data-testid="made-by">
        <span className="sb-made-with">
          built with <Heart className="sb-heart" role="img" aria-label="love" />{' '}
        </span>
        by{' '}
        <a href="https://mm.coffee" target="_blank" rel="noreferrer noopener">
          mm.coffee
        </a>
      </p>
      <TipGroup>
        <div className="sb-footer-links">
          <FooterPages baseUrl={baseUrl} container={container} current={current} />
          <div className="sb-footer-icons sb-footer-tools">
            <Upgrade baseUrl={baseUrl} container={container} logIn={() => setAccountOpen(true)} />
            <Shop baseUrl={baseUrl} container={container} />
            {settings}
            <Account baseUrl={baseUrl} container={container} open={accountOpen} setOpen={setAccountOpen} />
          </div>
        </div>
      </TipGroup>
    </footer>
  );
}

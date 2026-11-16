import { BookOpen, HandFist, Heart, Info, Scale, ScrollText, Sparkles } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { Account } from './Account';
import { Modal } from './Modal';
import { Shop } from './Shop';
import { Tip, TipGroup } from './Tip';

export type SitePageId = 'about' | 'docs' | 'manifesto' | 'credits' | 'policies';

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
 * manifesto, credits, policies) and the buttons (upgrade, cart, settings,
 * account).
 */
export function Footer({ baseUrl, container, current, settings }: FooterProps) {
  const link = (page: SitePageId, label: string, icon: ReactNode) => (
    <Tip label={label} container={container}>
      <a
        className={`sb-footer-icon sb-ico-${page}`}
        href={`${baseUrl}${page}`}
        data-testid={`nav-${page}`}
        aria-label={label}
        aria-current={current === page ? 'page' : undefined}
      >
        {icon}
      </a>
    </Tip>
  );
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
          {link('about', 'About', <Info />)}
          {link('docs', 'Docs', <BookOpen />)}
          {link('manifesto', 'Manifesto', <HandFist />)}
          {link('credits', 'Credits', <ScrollText />)}
          {link('policies', 'Policies', <Scale />)}
        </nav>
        <div className="sb-footer-icons sb-footer-tools">
          <Modal
            label="Upgrade"
            title="Upgrade"
            testId="upgrade"
            className="sb-ico-upgrade"
            icon={<Sparkles />}
            container={container}
          >
            <p className="sb-modal-text">
              A one-time upgrade is planned: extra effects beyond the free ones, and a place to show your beats. It
              is not open yet, and nothing can be bought here for now.
            </p>
            <p className="sb-modal-text">Everything on the machine today is free to use, and stays that way.</p>
          </Modal>
          <Shop baseUrl={baseUrl} container={container} />
          {settings}
          <Account baseUrl={baseUrl} container={container} />
        </div>
      </TipGroup>
    </footer>
  );
}

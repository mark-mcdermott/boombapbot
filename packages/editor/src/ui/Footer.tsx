import { BookOpen, CircleUserRound, Heart, Info, ShoppingCart, Sparkles } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { Modal } from './Modal';

export type SitePageId = 'about' | 'docs';

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

/** The row under every page: who made it, then about, docs, upgrade, cart, settings and account. */
export function Footer({ baseUrl, container, current, settings }: FooterProps) {
  const link = (page: SitePageId, label: string, icon: ReactNode) => (
    <a
      className="sb-footer-icon"
      href={`${baseUrl}${page}`}
      data-testid={`nav-${page}`}
      aria-label={label}
      aria-current={current === page ? 'page' : undefined}
    >
      {icon}
    </a>
  );
  return (
    <footer className="sb-footer">
      <p className="sb-made" data-testid="made-by">
        built with <Heart className="sb-heart" role="img" aria-label="love" /> by{' '}
        <a href="https://mm.coffee" target="_blank" rel="noreferrer noopener">
          mm.coffee
        </a>
      </p>
      <nav className="sb-footer-actions" aria-label="Site">
        {link('about', 'About', <Info />)}
        {link('docs', 'Docs', <BookOpen />)}
        <Modal label="Upgrade" title="Upgrade" testId="upgrade" icon={<Sparkles />} container={container}>
          <p className="sb-modal-text">
            Upgrades are not open yet. Everything on the machine today is free to use, and stays that way.
          </p>
        </Modal>
        <Modal label="Cart" title="Cart" testId="cart" icon={<ShoppingCart />} container={container}>
          <p className="sb-modal-text">The shop is not open yet, so there is nothing to put in a cart.</p>
        </Modal>
        {settings}
        <Modal label="Account" title="Your account" testId="account" icon={<CircleUserRound />} container={container}>
          <p className="sb-modal-text">
            Accounts are not switched on yet. When they are, this is where you will sign up and log in.
          </p>
          <p className="sb-modal-text">
            Until then, everything you make is saved in this browser. Export the project file from settings to keep
            a copy or move it to another device.
          </p>
        </Modal>
      </nav>
    </footer>
  );
}

import { ShoppingBag } from 'lucide-react';
import { useState, type ReactNode, type RefObject } from 'react';
import { Account } from './Account';
import { FooterPages } from './Footer';
import type { SitePageId } from './pages';
import { Tip, TipGroup } from './Tip';

/** What sits under the machine: handed the settings button and where modals and tips mount. */
export type BelowMachine = (settings: ReactNode, container: RefObject<HTMLElement | null>) => ReactNode;

/**
 * What sits under the machine in a shell with no site behind it: its
 * settings and nothing else. Hand it to `BoombapbotEditor` as `below`.
 */
export function shellFooter(settings: ReactNode): ReactNode {
  return (
    <footer className="sb-footer">
      <div className="sb-footer-icons sb-footer-tools">{settings}</div>
    </footer>
  );
}

/** What a shell that carries the pages of words leads to. */
export interface ShellSite {
  /** What a page's address starts with inside the shell, ending in a slash. */
  pagesUrl: string;
  /** The shop, which is on the site and opens outside the shell. */
  shopUrl: string;
  /**
   * The site's address, ending in a slash, if the shell reaches its server
   * (see `linkServer`). With it the machine's screen has the account button.
   */
  serverUrl?: string;
}

interface ShellSiteFooterProps {
  site: ShellSite;
  /** Where the tips mount, so they inherit the page's theme. */
  container: RefObject<HTMLElement | null>;
  /** The page this footer is on, if it is one it links to. */
  current?: SitePageId;
  /** The settings button. Only the machine's screen has settings. */
  settings?: ReactNode;
}

/**
 * The footer of a shell that carries the pages of words: the pages, the way
 * out to the shop, the settings, and beside the settings the account, where
 * the shell reaches the site's server. It has no cart or upgrade.
 */
export function ShellSiteFooter({ site, container, current, settings }: ShellSiteFooterProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  return (
    <footer className="sb-footer">
      <TipGroup>
        <div className="sb-footer-links">
          <FooterPages baseUrl={site.pagesUrl} container={container} current={current} />
          <div className="sb-footer-icons sb-footer-tools">
            <Tip label="Merch" container={container}>
              <a
                className="sb-footer-icon sb-ico-merch"
                href={site.shopUrl}
                target="_blank"
                rel="noreferrer noopener"
                data-testid="nav-merch"
                aria-label="Merch, on the boombapbot site"
              >
                <ShoppingBag />
                <span className="sb-footer-word">Merch</span>
              </a>
            </Tip>
            {settings}
            {settings && site.serverUrl && (
              <Account baseUrl={site.serverUrl} container={container} open={accountOpen} setOpen={setAccountOpen} />
            )}
          </div>
        </div>
      </TipGroup>
    </footer>
  );
}

/** `ShellSiteFooter` under the machine. Hand its result to `BoombapbotEditor` as `below`. */
export function shellSiteFooter(site: ShellSite): BelowMachine {
  return (settings, container) => <ShellSiteFooter site={site} container={container} settings={settings} />;
}

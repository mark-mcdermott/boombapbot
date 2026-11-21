import { useEffect, useSyncExternalStore } from 'react';
import { ShellSiteFooter, SitePage, type ShellSite } from '@boombapbot/editor';
import { pageFromHash, type CarriedPages } from './pages';

function onAddressChange(changed: () => void): () => void {
  window.addEventListener('hashchange', changed);
  return () => window.removeEventListener('hashchange', changed);
}

interface PageScreenProps {
  pages: CarriedPages;
  site: ShellSite;
  /** The machine's screen, which stays as it is, playing or not, behind a page. */
  machineScreen: HTMLElement;
}

/** The page of words the address names, in place of the machine while it is open. */
export function PageScreen({ pages, site, machineScreen }: PageScreenProps) {
  const current = useSyncExternalStore(onAddressChange, () => pageFromHash(window.location.hash, pages));

  useEffect(() => {
    machineScreen.hidden = current !== null;
    window.scrollTo(0, 0);
  }, [current, machineScreen]);

  const page = current && pages[current];
  if (!current || !page) return null;
  return (
    <SitePage
      baseUrl={site.pagesUrl}
      current={current}
      layout={page.layout}
      footer={(container) => <ShellSiteFooter site={site} container={container} current={current} />}
    >
      <div className="app-page-words" dangerouslySetInnerHTML={{ __html: page.html }} />
    </SitePage>
  );
}

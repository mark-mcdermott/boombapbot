import { useRef, type ReactNode } from 'react';
import { Footer } from './Footer';
import { Header } from './Header';
import type { SitePageId } from './pages';
import { SiteNav } from './SiteNav';

/** `sheet` sets headings beside what they head; `note` is one narrow column, for a piece meant to be read through. */
export type SitePageLayout = 'sheet' | 'note';

export interface SitePageProps {
  /** Base URL the site is served from. */
  baseUrl?: string;
  current: SitePageId;
  layout?: SitePageLayout;
  children: ReactNode;
}

/** A page of words: the compact masthead, the words, and the same footer as the machine. */
export function SitePage({ baseUrl = '/', current, layout = 'sheet', children }: SitePageProps) {
  const modals = useRef<HTMLDivElement>(null);
  return (
    <div className="sb-app sb-words" data-layout={layout} data-testid="site-page">
      <Header baseUrl={baseUrl}>
        <SiteNav baseUrl={baseUrl} current={current} />
      </Header>
      <main className="sb-prose">{children}</main>
      <Footer baseUrl={baseUrl} container={modals} current={current} />
      <div ref={modals} className="sb-modal-root" />
    </div>
  );
}

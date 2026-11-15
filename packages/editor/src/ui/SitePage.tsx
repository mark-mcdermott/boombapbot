import { useRef, type ReactNode } from 'react';
import { Footer, type SitePageId } from './Footer';
import { Header } from './Header';

export interface SitePageProps {
  /** Base URL the site is served from. */
  baseUrl?: string;
  current: SitePageId;
  children: ReactNode;
}

/** A page of words between the same header and footer as the machine. */
export function SitePage({ baseUrl = '/', current, children }: SitePageProps) {
  const modals = useRef<HTMLDivElement>(null);
  return (
    <div className="sb-app" data-testid="site-page">
      <Header baseUrl={baseUrl} />
      <main className="sb-prose">{children}</main>
      <Footer baseUrl={baseUrl} container={modals} current={current} />
      <div ref={modals} className="sb-modal-root" />
    </div>
  );
}

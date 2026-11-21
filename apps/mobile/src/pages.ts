import { SITE_PAGES, type SitePageId, type SitePageLayout } from '@boombapbot/editor';

/** The file `scripts/copy-app-pages.mjs` writes: the site's pages of words, by name. */
export const PAGES_FILE = 'boombapbot-pages.json';

/** What a page's address starts with in the app, where a page is a place in the one document. */
export const PAGES_URL = '#/';

export interface CarriedPage {
  layout: SitePageLayout;
  /** The words as the site built them. They are this repository's own and are shown as they are. */
  html: string;
}

export type CarriedPages = Partial<Record<SitePageId, CarriedPage>>;

const LAYOUTS: readonly SitePageLayout[] = ['sheet', 'note'];

function isCarriedPage(value: unknown): value is CarriedPage {
  if (typeof value !== 'object' || value === null) return false;
  const { layout, html } = value as Record<string, unknown>;
  return typeof html === 'string' && LAYOUTS.includes(layout as SitePageLayout);
}

/** The pages in what the app carries, leaving out any the footer has no link to. */
export function readPages(carried: unknown): CarriedPages {
  if (typeof carried !== 'object' || carried === null) throw new Error('the pages file is not a list of pages');
  const pages: CarriedPages = {};
  for (const { id } of SITE_PAGES) {
    const page = (carried as Record<string, unknown>)[id];
    if (isCarriedPage(page)) pages[id] = page;
  }
  return pages;
}

/** The page an address names, or null for the machine and for a page the app does not carry. */
export function pageFromHash(hash: string, pages: CarriedPages): SitePageId | null {
  if (!hash.startsWith(PAGES_URL)) return null;
  const name = hash.slice(PAGES_URL.length);
  return SITE_PAGES.find(({ id }) => id === name && pages[id])?.id ?? null;
}

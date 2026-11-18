/** The pages of words the masthead and the footer lead to, in the order both use. */
export const SITE_PAGES = [
  { id: 'about', label: 'About' },
  { id: 'docs', label: 'Docs' },
  { id: 'manifesto', label: 'Manifesto' },
  { id: 'policies', label: 'Policies' },
] as const;

export type ListedPageId = (typeof SITE_PAGES)[number]['id'];

/**
 * Every page of words. Credits has nothing written on it yet, so nothing
 * leads to it: it stands at its own address until there is something to read.
 */
export type SitePageId = ListedPageId | 'credits';

/** The pages of words, in the order every list of them uses. */
export const SITE_PAGES = [
  { id: 'about', label: 'About' },
  { id: 'docs', label: 'Docs' },
  { id: 'manifesto', label: 'Manifesto' },
  { id: 'credits', label: 'Credits' },
  { id: 'policies', label: 'Policies' },
] as const;

export type SitePageId = (typeof SITE_PAGES)[number]['id'];

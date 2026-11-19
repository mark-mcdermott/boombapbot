/** The pages of words the masthead and the footer lead to, in the order both use. */
export const SITE_PAGES = [
  { id: 'about', label: 'About' },
  { id: 'docs', label: 'Docs' },
  { id: 'manifesto', label: 'Manifesto' },
  { id: 'policies', label: 'Policies' },
] as const;

export type SitePageId = (typeof SITE_PAGES)[number]['id'];

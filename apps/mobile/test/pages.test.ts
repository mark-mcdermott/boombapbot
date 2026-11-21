import { describe, expect, it } from 'vitest';
import { pageFromHash, readPages, type CarriedPages } from '../src/pages';

const pages: CarriedPages = {
  about: { layout: 'sheet', html: '<h1>About</h1>' },
  manifesto: { layout: 'note', html: '<h1>Manifesto</h1>' },
};

describe('the pages the app carries', () => {
  it('keeps the pages the footer links to and drops the rest', () => {
    const read = readPages({ ...pages, shop: { layout: 'sheet', html: '' }, docs: { layout: 'wide', html: '' }, policies: 'words' });
    expect(read).toEqual(pages);
  });

  it('refuses a file that is not a list of pages', () => {
    expect(() => readPages(null)).toThrow('not a list of pages');
  });
});

describe('the page an address names', () => {
  it('is the page after the hash', () => {
    expect(pageFromHash('#/about', pages)).toBe('about');
    expect(pageFromHash('#/manifesto', pages)).toBe('manifesto');
  });

  it('is the machine for no hash, the bare one, and anything that is not a page', () => {
    for (const hash of ['', '#', '#/', '#about', '#/shop', '#/about/more']) expect(pageFromHash(hash, pages)).toBeNull();
  });

  it('is the machine for a page the app does not carry', () => {
    expect(pageFromHash('#/docs', pages)).toBeNull();
  });
});

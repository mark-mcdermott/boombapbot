import { describe, expect, it } from 'vitest';
import { toCatalogCountries, toCatalogProduct, toCents } from '../../../scripts/sync-shop.mjs';
import {
  AddressSchema,
  SHOP,
  ShopCatalogSchema,
  ShopProductSchema,
  addressProblem,
  formatPrice,
  priceCart,
  shopIsOpen,
  subtotalCents,
  type ShopCatalog,
} from '../src/shop';

const catalog: ShopCatalog = {
  syncedAt: null,
  countries: [
    { code: 'DE', name: 'Germany', states: [] },
    { code: 'US', name: 'United States', states: [{ code: 'TX', name: 'Texas' }] },
  ],
  products: [
    {
      id: '100',
      name: 'Hoodie',
      image: null,
      variants: [
        { id: '1001', catalogVariantId: 501, label: 'M', priceCents: 4000 },
        { id: '1002', catalogVariantId: 502, label: 'XL', priceCents: 4200 },
      ],
    },
  ],
};

const address = { name: 'Pat', line1: '1 Snare St', line2: null, city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' };

describe('the shop catalog', () => {
  it('the committed catalog is valid', () => {
    expect(ShopCatalogSchema.safeParse(SHOP).success).toBe(true);
  });

  it('is open only with something to sell and somewhere to send it', () => {
    expect(shopIsOpen(catalog)).toBe(true);
    expect(shopIsOpen({ ...catalog, countries: [] })).toBe(false);
    expect(shopIsOpen({ ...catalog, products: [] })).toBe(false);
  });

  it('wants a country it ships to, and a state where the country has them', () => {
    expect(addressProblem(catalog, address)).toBeNull();
    expect(addressProblem(catalog, { ...address, country: 'DE', state: null })).toBeNull();
    expect(addressProblem(catalog, { ...address, state: null })).toMatch(/state/);
    expect(addressProblem(catalog, { ...address, state: 'ZZ' })).toMatch(/state/);
    expect(addressProblem(catalog, { ...address, country: 'FR' })).toMatch(/country/);
    expect(AddressSchema.safeParse({ ...address, line1: '   ' }).success).toBe(false);
  });

  it('prices a cart from the catalog, adds repeated lines together and drops what is not for sale', () => {
    const lines = priceCart(catalog, [
      { variantId: '1001', quantity: 1 },
      { variantId: '9999', quantity: 3 },
      { variantId: '1002', quantity: 2 },
      { variantId: '1001', quantity: 1 },
    ]);
    expect(lines.map((line) => [line.variant.label, line.quantity])).toEqual([
      ['M', 2],
      ['XL', 2],
    ]);
    expect(subtotalCents(lines)).toBe(16400);
    expect(formatPrice(16400)).toBe('$164.00');
  });
});

describe('reading a product from Printful', () => {
  // The shape of Printful's answer to GET /store/products/{id}, cut down to what is read.
  const detail = {
    sync_product: { id: 494200338, name: 'Unisex Hoodie', thumbnail_url: 'https://example.com/hoodie.png' },
    sync_variants: [
      { id: 1, variant_id: 24975, name: 'Unisex Hoodie / S', size: 'S', color: 'Bone', retail_price: '36.50', currency: 'USD' },
      { id: 2, variant_id: 24976, name: 'Unisex Hoodie / M', size: 'M', color: 'Bone', retail_price: '38.00', currency: 'USD' },
      { id: 3, variant_id: 24977, name: 'Unisex Hoodie / L', size: 'L', color: 'Bone', retail_price: '38.00', currency: 'USD', is_ignored: true },
    ],
  };

  it('keeps the variants for sale, labelled by size and priced in cents', () => {
    const product = toCatalogProduct(detail, '/shop/494200338.png');
    expect(ShopProductSchema.safeParse(product).success).toBe(true);
    expect(product.variants).toEqual([
      { id: '1', catalogVariantId: 24975, label: 'S', priceCents: 3650 },
      { id: '2', catalogVariantId: 24976, label: 'M', priceCents: 3800 },
    ]);
  });

  it('names the colour too when there is more than one', () => {
    const twoColours = {
      ...detail,
      sync_variants: [detail.sync_variants[0], { ...detail.sync_variants[1], color: 'Black' }],
    };
    expect(toCatalogProduct(twoColours, null).variants.map((variant) => variant.label)).toEqual([
      'Bone / S',
      'Black / M',
    ]);
  });

  it('lists countries by name, with their states where they have them', () => {
    const countries = toCatalogCountries([
      { code: 'US', name: 'United States', states: [{ code: 'TX', name: 'Texas' }], region: 'americas' },
      { code: 'DE', name: 'Germany', states: null, region: 'europe' },
    ]);
    expect(countries).toEqual([
      { code: 'DE', name: 'Germany', states: [] },
      { code: 'US', name: 'United States', states: [{ code: 'TX', name: 'Texas' }] },
    ]);
  });

  it('refuses a price it cannot read or a currency the shop does not charge in', () => {
    expect(toCents('36.50')).toBe(3650);
    expect(() => toCents('free')).toThrow();
    const euros = { ...detail, sync_variants: [{ ...detail.sync_variants[0], currency: 'EUR' }] };
    expect(() => toCatalogProduct(euros, null)).toThrow(/EUR/);
  });
});

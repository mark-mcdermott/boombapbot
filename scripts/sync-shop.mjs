#!/usr/bin/env node
// Reads the products of the Printful store, and the countries Printful
// delivers to, and writes the shop's catalog
// (packages/contracts/data/shop.json), with a picture of each product under
// apps/site/public/shop. It only reads from Printful.
//
//   pnpm shop:sync
//
// Needs PRINTFUL_API_KEY in apps/site/.env (and PRINTFUL_STORE_ID if the
// token can reach more than one store). Commit what it writes.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSiteEnv, printfulClient } from './printful-api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = join(root, 'packages/contracts/data/shop.json');
const imageDir = join(root, 'apps/site/public/shop');
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** "45.00" becomes 4500. */
export function toCents(price) {
  const cents = Math.round(Number(price) * 100);
  if (!Number.isInteger(cents) || cents <= 0) throw new Error(`"${price}" is not a price`);
  return cents;
}

/**
 * One product as the catalog holds it, from Printful's answer to
 * GET /store/products/{id}. Variants Printful is told to ignore are left out.
 */
export function toCatalogProduct({ sync_product: product, sync_variants: variants }, image) {
  const forSale = variants.filter((variant) => !variant.is_ignored);
  if (forSale.length === 0) throw new Error(`"${product.name}" has no variants for sale`);
  const colours = new Set(forSale.map((variant) => variant.color).filter(Boolean));
  return {
    id: String(product.id),
    name: product.name,
    image,
    variants: forSale.map((variant) => {
      if (String(variant.currency).toUpperCase() !== 'USD') {
        throw new Error(`"${variant.name}" is priced in ${variant.currency}; the shop charges in USD`);
      }
      const parts = [colours.size > 1 ? variant.color : null, variant.size].filter(Boolean);
      return {
        id: String(variant.id),
        catalogVariantId: variant.variant_id,
        label: parts.length > 0 ? parts.join(' / ') : variant.name,
        priceCents: toCents(variant.retail_price),
      };
    }),
  };
}

/** Printful's country list as the catalog holds it, in alphabetical order. */
export function toCatalogCountries(countries) {
  return countries
    .map((country) => ({
      code: country.code,
      name: country.name,
      states: (country.states ?? []).map((state) => ({ code: state.code, name: state.name })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** Saves the product's picture beside the site's other files and returns its path there. */
async function savePicture(product) {
  if (!product.thumbnail_url) return null;
  const response = await fetch(product.thumbnail_url);
  const extension = IMAGE_TYPES[response.headers.get('content-type')?.split(';')[0] ?? ''];
  if (!response.ok || !extension) {
    console.warn(`sync-shop: no usable picture for "${product.name}" (${response.status})`);
    return null;
  }
  mkdirSync(imageDir, { recursive: true });
  const name = `${product.id}.${extension}`;
  writeFileSync(join(imageDir, name), Buffer.from(await response.arrayBuffer()));
  return `/shop/${name}`;
}

async function main() {
  loadSiteEnv();
  const printful = printfulClient({ token: process.env.PRINTFUL_API_KEY, storeId: process.env.PRINTFUL_STORE_ID });

  const listed = await printful('/store/products?limit=100');
  const products = [];
  for (const entry of listed.filter((product) => !product.is_ignored)) {
    const detail = await printful(`/store/products/${entry.id}`);
    products.push(toCatalogProduct(detail, await savePicture(detail.sync_product)));
  }

  const countries = toCatalogCountries(await printful('/countries'));
  const catalog = { syncedAt: new Date().toISOString(), countries, products };
  writeFileSync(catalogPath, `${JSON.stringify(catalog)}\n`);

  for (const product of products) {
    console.log(`sync-shop: ${product.name} (${product.id})`);
    for (const variant of product.variants) {
      console.log(`  ${variant.label.padEnd(16)} ${(variant.priceCents / 100).toFixed(2)} USD  variant ${variant.id}`);
    }
  }
  console.log(
    `sync-shop: wrote ${products.length} product(s) and ${countries.length} countries to packages/contracts/data/shop.json`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`sync-shop: ${error.message}`);
    process.exit(1);
  });
}

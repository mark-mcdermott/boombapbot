import { readFile } from 'node:fs/promises';
import { SHOP_CATALOG } from 'astro:env/server';
import { SHOP, ShopCatalogSchema, type ShopCatalog } from '@boombapbot/contracts';

let catalog: ShopCatalog | null = null;

/**
 * What is for sale. It is the committed catalog, unless SHOP_CATALOG names
 * another file, which only the tests do. The page asks this server for it,
 * so the prices shown are the prices charged.
 */
export async function getCatalog(): Promise<ShopCatalog> {
  catalog ??= SHOP_CATALOG ? ShopCatalogSchema.parse(JSON.parse(await readFile(SHOP_CATALOG, 'utf8'))) : SHOP;
  return catalog;
}

import { z } from 'zod';
import shopData from '../data/shop.json';

// The shop's catalog: what is for sale, in which sizes, for how much, and
// where it can be sent. `data/shop.json` is written by `pnpm shop:sync` from
// the Printful store. The page shows prices from it and the server charges
// from it, so the two cannot disagree. Shipping is not in it: Printful
// quotes that for each address.

const Cents = z.number().int().positive();

export const ShopVariantSchema = z.object({
  /** Printful's sync variant id. It is also what a cart line refers to. */
  id: z.string().regex(/^\d+$/),
  /** Printful's id for the blank garment in this size, which its shipping quotes are asked by. */
  catalogVariantId: z.number().int().positive(),
  /** What the buyer picks: a size, or a size and colour. */
  label: z.string().min(1),
  priceCents: Cents,
});
export type ShopVariant = z.infer<typeof ShopVariantSchema>;

export const ShopProductSchema = z.object({
  /** Printful's sync product id. */
  id: z.string().regex(/^\d+$/),
  name: z.string().min(1),
  /** A path on this site, or null when there is no picture yet. */
  image: z.string().startsWith('/').nullable(),
  variants: z.array(ShopVariantSchema).min(1),
});
export type ShopProduct = z.infer<typeof ShopProductSchema>;

export const CountrySchema = z.object({
  /** Two letters, as Printful and the post office know it. */
  code: z.string().regex(/^[A-Z]{2}$/),
  name: z.string().min(1),
  /** States or provinces, where an address there needs one. */
  states: z.array(z.object({ code: z.string().min(1), name: z.string().min(1) })),
});
export type Country = z.infer<typeof CountrySchema>;

export const ShopCatalogSchema = z.object({
  /** When the products were last read from Printful. */
  syncedAt: z.string().nullable(),
  /** Where Printful delivers. */
  countries: z.array(CountrySchema),
  products: z.array(ShopProductSchema),
});
export type ShopCatalog = z.infer<typeof ShopCatalogSchema>;

/** What the site answers when the page asks what is for sale. */
export const ShopAnswerSchema = ShopCatalogSchema.extend({
  /** Whether an order can be paid for right now. */
  payments: z.boolean(),
});
export type ShopAnswer = z.infer<typeof ShopAnswerSchema>;

export const SHOP_CURRENCY = 'usd';
export const SHOP: ShopCatalog = ShopCatalogSchema.parse(shopData);

/** The shop is open once there is something to sell and somewhere to send it. */
export function shopIsOpen(catalog: ShopCatalog): boolean {
  return catalog.products.length > 0 && catalog.countries.length > 0;
}

const line = (max: number) => z.string().trim().min(1).max(max);

/** Where an order goes. `state` is required only where the country has states. */
export const AddressSchema = z.object({
  name: line(100),
  line1: line(200),
  line2: z.string().trim().max(200).nullable(),
  city: line(100),
  state: z.string().trim().max(10).nullable(),
  postalCode: line(20),
  country: z.string().regex(/^[A-Z]{2}$/),
});
export type Address = z.infer<typeof AddressSchema>;

/** What is wrong with an address for this catalog, or null. */
export function addressProblem(catalog: ShopCatalog, address: Address): string | null {
  const country = catalog.countries.find((candidate) => candidate.code === address.country);
  if (!country) return 'I cannot ship to that country.';
  if (country.states.length > 0 && !country.states.some((state) => state.code === address.state)) {
    return 'Choose a state or province.';
  }
  return null;
}

/** One way Printful can send an order to an address, and what it costs. */
export const ShippingQuoteSchema = z.object({
  /** Printful's name for the method, which the order is placed with. */
  id: z.string().min(1),
  label: z.string().min(1),
  cents: z.number().int().nonnegative(),
  minDays: z.number().int().nonnegative(),
  maxDays: z.number().int().nonnegative(),
});
export type ShippingQuote = z.infer<typeof ShippingQuoteSchema>;

export const QuoteAnswerSchema = z.object({ quotes: z.array(ShippingQuoteSchema).min(1) });
export const CheckoutAnswerSchema = z.object({ url: z.string().url() });

/** A cart and where it is going: what the page sends to ask for quotes. */
export const QuoteRequestSchema = z.object({ items: z.lazy(() => CartSchema), address: AddressSchema });
/** The same, with the method chosen: what the page sends to check out. */
export const CheckoutRequestSchema = QuoteRequestSchema.extend({ shippingId: z.string().min(1).max(60) });

export const MAX_CART_LINES = 20;
export const MAX_LINE_QUANTITY = 10;

export const CartLineSchema = z.object({
  variantId: z.string().regex(/^\d+$/),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});
export type CartLine = z.infer<typeof CartLineSchema>;

export const CartSchema = z.array(CartLineSchema).max(MAX_CART_LINES);
export type Cart = z.infer<typeof CartSchema>;

/** A cart line with what the catalog says about it. */
export interface PricedLine {
  product: ShopProduct;
  variant: ShopVariant;
  quantity: number;
}

export function findVariant(
  catalog: ShopCatalog,
  variantId: string,
): { product: ShopProduct; variant: ShopVariant } | null {
  for (const product of catalog.products) {
    const variant = product.variants.find((candidate) => candidate.id === variantId);
    if (variant) return { product, variant };
  }
  return null;
}

/**
 * The cart as the catalog prices it. A line whose variant is no longer for
 * sale is left out, and lines for the same variant are added together.
 */
export function priceCart(catalog: ShopCatalog, cart: Cart): PricedLine[] {
  const quantities = new Map<string, number>();
  for (const line of cart) {
    quantities.set(line.variantId, (quantities.get(line.variantId) ?? 0) + line.quantity);
  }
  const lines: PricedLine[] = [];
  for (const [variantId, quantity] of quantities) {
    const found = findVariant(catalog, variantId);
    if (found) lines.push({ ...found, quantity: Math.min(quantity, MAX_LINE_QUANTITY) });
  }
  return lines;
}

export function subtotalCents(lines: PricedLine[]): number {
  return lines.reduce((sum, line) => sum + line.variant.priceCents * line.quantity, 0);
}

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: SHOP_CURRENCY.toUpperCase() }).format(
    cents / 100,
  );
}

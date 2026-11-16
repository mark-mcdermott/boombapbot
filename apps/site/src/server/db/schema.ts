import type { Address, Project } from '@boombapbot/contracts';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Every table has two keys. `id` is a plain integer for joins and never
// leaves the server. `uuid` is the only name a row has outside it: in a URL,
// an API response or an email.
const rowId = () => integer('id').primaryKey().generatedByDefaultAsIdentity();
const publicId = () => uuid('uuid').notNull().unique().defaultRandom();
const moment = (name: string) => timestamp(name, { withTimezone: true });

// The four tables Better Auth reads and writes. The columns are its contract:
// one missing here fails at sign-in, not at compile time.

export const user = pgTable('users', {
  id: rowId(),
  uuid: publicId(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow(),
});

const owner = () =>
  integer('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' });

export const session = pgTable(
  'sessions',
  {
    id: rowId(),
    uuid: publicId(),
    userId: owner(),
    token: text('token').notNull().unique(),
    expiresAt: moment('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

/** How a user signs in. For email and password, `password` holds the hash. */
export const account = pgTable(
  'accounts',
  {
    id: rowId(),
    uuid: publicId(),
    userId: owner(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: moment('access_token_expires_at'),
    refreshTokenExpiresAt: moment('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (table) => [index('accounts_user_id_idx').on(table.userId)],
);

/** Email verification and password reset tokens. Both are short-lived. */
export const verification = pgTable(
  'verifications',
  {
    id: rowId(),
    uuid: publicId(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: moment('expires_at').notNull(),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);

/** What was bought, as it was priced when the order was made. */
export interface OrderItem {
  /** Printful's sync variant id. */
  variantId: string;
  name: string;
  label: string;
  quantity: number;
  priceCents: number;
}

/**
 * pending: checkout started. paid: Stripe took the money. processing: sent to
 * be printed. Then shipped, or failed or canceled if the printer said so.
 */
export const ORDER_STATUSES = ['pending', 'paid', 'processing', 'shipped', 'failed', 'canceled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** A shop order. The buyer need not have an account. */
export const order = pgTable(
  'orders',
  {
    id: rowId(),
    uuid: publicId(),
    userId: integer('user_id').references(() => user.id, { onDelete: 'set null' }),
    email: text('email'),
    status: text('status').$type<OrderStatus>().notNull().default('pending'),
    items: jsonb('items').$type<OrderItem[]>().notNull(),
    subtotalCents: integer('subtotal_cents').notNull(),
    shippingCents: integer('shipping_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    shippingAddress: jsonb('shipping_address').$type<Address>().notNull(),
    /** Printful's name for the delivery method the buyer chose. */
    shippingMethod: text('shipping_method').notNull(),
    stripeSessionId: text('stripe_session_id').unique(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    printfulOrderId: text('printful_order_id'),
    trackingNumber: text('tracking_number'),
    trackingUrl: text('tracking_url'),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (table) => [index('orders_user_id_idx').on(table.userId)],
);

/**
 * A beat saved to an account: the project as the machine holds it, already
 * checked against the project schema. `bytes` is what it weighed when saved.
 */
export const beat = pgTable(
  'beats',
  {
    id: rowId(),
    uuid: publicId(),
    userId: owner(),
    name: text('name').notNull(),
    project: jsonb('project').$type<Project>().notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (table) => [index('beats_user_id_idx').on(table.userId)],
);

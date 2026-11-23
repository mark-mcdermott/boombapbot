import type { Address, AvatarType, ProjectBase } from '@boombapbot/contracts';
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Every table has two keys. `id` is a plain integer for joins and never
// leaves the server. `uuid` is the only name a row has outside it: in a URL,
// an API response or an email.
const rowId = () => integer('id').primaryKey().generatedByDefaultAsIdentity();
const publicId = () => uuid('uuid').notNull().unique().defaultRandom();
const moment = (name: string) => timestamp(name, { withTimezone: true });

// The five tables Better Auth reads and writes. The columns are its contract:
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

/**
 * How often one address has lately asked for one of Better Auth's routes:
 * `key` is the address and the route, `lastRequest` a time in milliseconds.
 * It is counted here so that every server counts together. Better Auth
 * writes the rows and clears the old ones away; nothing joins to one.
 */
export const rateLimit = pgTable('rate_limits', {
  id: rowId(),
  uuid: publicId(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

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
    project: jsonb('project').$type<ProjectBase>().notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (table) => [index('beats_user_id_idx').on(table.userId)],
);

/**
 * How many beats an account holds, kept beside `beats` so that saving one
 * can check the limit and take the room in a single statement: two saves at
 * once queue on this row, and the second sees the first one's count. The
 * beats routes keep it in step, in the same statements that insert and
 * delete a beat. An account with no row has never saved one.
 */
export const beatCount = pgTable(
  'beat_counts',
  {
    id: rowId(),
    uuid: publicId(),
    userId: owner().unique(),
    count: integer('count').notNull(),
  },
  (table) => [check('beat_counts_count_not_negative', sql`${table.count} >= 0`)],
);

/**
 * An account's picture: one small square, as the page sent it, in base64.
 * A new picture takes a new uuid, so the address it is served at never
 * changes what it shows and can be cached for good. The account's `image`
 * names that address.
 */
export const avatar = pgTable(
  'avatars',
  {
    id: rowId(),
    uuid: publicId(),
    userId: owner().unique(),
    type: text('type').$type<AvatarType>().notNull(),
    data: text('data').notNull(),
    createdAt: moment('created_at').notNull().defaultNow(),
  },
  (table) => [
    check('avatars_type_known', sql`${table.type} in ('image/webp', 'image/jpeg', 'image/png')`),
  ],
);

/**
 * A paid upgrade and its key. A row is made only when Stripe says the money
 * arrived, so every row is a license somebody bought, and `stripeSessionId`
 * is what keeps one payment to one key however often Stripe reports it. The
 * buyer need not have an account: `userId` is empty until the key is
 * entered in one, and empty again if that account is deleted, when the key
 * can go onto another, or if the payment is refunded, when it cannot. An
 * account holds one license at most.
 */
export const license = pgTable(
  'licenses',
  {
    id: rowId(),
    uuid: publicId(),
    userId: integer('user_id')
      .unique()
      .references(() => user.id, { onDelete: 'set null' }),
    /** Where the key was sent, in lower case. It can be sent there again. */
    email: text('email').notNull(),
    key: text('key').notNull().unique(),
    stripeSessionId: text('stripe_session_id').notNull().unique(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    /** When the key last went out by email. Empty until the first one has. */
    emailedAt: moment('emailed_at'),
    /** When it was refunded or taken back. From then it is on no account and gives out no license file; files already out keep working. */
    withdrawnAt: moment('withdrawn_at'),
    createdAt: moment('created_at').notNull().defaultNow(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (table) => [index('licenses_email_idx').on(table.email)],
);

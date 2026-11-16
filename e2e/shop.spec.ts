import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  ACCOUNTS_URL,
  FAKE_SERVICES_URL,
  PRINTFUL_WEBHOOK_SECRET,
  STRIPE_WEBHOOK_SECRET,
} from './accounts-server';
import { openEditor } from './helpers';
import { linkIn, newAddress } from './mail';

// These run against the built server with the catalog in e2e/fixtures/shop.json
// (a hoodie, M at 40.00 and XL at 42.00, sent to Canada, Germany or the United
// States), and a fake that answers for Stripe and Printful
// (e2e/fake-shop-services.mjs): shipping is 5.00 or 15.25 within the United
// States and 9.50 anywhere else.

// One worker, in order: the fake remembers every call it was sent.
test.describe.configure({ mode: 'serial' });

interface FakeCall {
  service: 'stripe' | 'printful';
  call: 'checkout' | 'rates' | 'create' | 'confirm';
  id: string | number;
  form?: Record<string, string>;
  body?: {
    external_id?: string;
    shipping?: string;
    recipient: Record<string, string>;
    items: Array<{ sync_variant_id?: number; variant_id?: number; quantity: number }>;
    retail_costs?: Record<string, string>;
  };
  failed?: boolean;
}

async function calls(request: APIRequestContext): Promise<FakeCall[]> {
  return (await request.get(`${FAKE_SERVICES_URL}/calls`)).json();
}

const json = { origin: ACCOUNTS_URL, 'content-type': 'application/json' };

const AUSTIN = {
  name: 'Pat Drummer',
  line1: '1 Snare St',
  line2: null,
  city: 'Austin',
  state: 'TX',
  postalCode: '78701',
  country: 'US',
};

/** Starts a checkout over the API, to Austin by the standard post, and returns the order's uuid. */
async function checkout(request: APIRequestContext, items: unknown): Promise<string> {
  const answer = await request.post('/api/store/checkout', {
    data: { items, address: AUSTIN, shippingId: 'STANDARD' },
    headers: json,
  });
  expect(answer.status(), await answer.text()).toBe(200);
  const order = new URL((await answer.json()).url).searchParams.get('order');
  expect(order).toBeTruthy();
  return order!;
}

/** What Stripe sends when a checkout is paid, signed the way Stripe signs it. */
function paidEvent(order: string, secret = STRIPE_WEBHOOK_SECRET) {
  const payload = JSON.stringify({
    id: `evt_${order}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_${order}`,
        object: 'checkout.session',
        payment_status: 'paid',
        payment_intent: `pi_${order}`,
        amount_total: 12700,
        customer_details: { email: 'buyer@example.com' },
        metadata: { order },
      },
    },
  });
  const time = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${time}.${payload}`).digest('hex');
  return { data: payload, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${time},v1=${signature}` } };
}

const forOrder = (all: FakeCall[], order: string) => {
  const external = order.replaceAll('-', '');
  const created = all.filter((call) => call.call === 'create' && call.body?.external_id === external);
  const ids = new Set(created.map((call) => call.id));
  return { created, confirmed: all.filter((call) => call.call === 'confirm' && ids.has(call.id)) };
};

/**
 * What an accessibility scan finds wrong with the open shop, and where. The
 * modal fades in, and a scan of half-faded text sees contrast that is not there.
 */
async function violations(page: Page): Promise<string[]> {
  const modal = page.getByTestId('cart-modal');
  await expect.poll(() => modal.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  const found = (await new AxeBuilder({ page }).analyze()).violations;
  return found.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

async function openShop(page: Page): Promise<void> {
  await openEditor(page);
  await page.getByTestId('cart').click();
  await expect(page.getByTestId('product-100')).toBeVisible();
}

test('a hoodie goes from the shop to the cart to checkout and back', async ({ page, request }) => {
  await openShop(page);
  await expect(page.getByTestId('cart-empty')).toBeVisible();
  await expect(page.getByTestId('product-price')).toHaveText('$40.00');

  // Two of the M, then one XL, which costs more.
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('add-to-cart').click();
  await expect(page.getByTestId('cart-line-1001').getByTestId('cart-quantity')).toHaveText('2');
  await page.getByTestId('variant-1002').click();
  await expect(page.getByTestId('product-price')).toHaveText('$42.00');
  await page.getByTestId('add-to-cart').click();
  await expect(page.getByTestId('cart-subtotal')).toHaveText('$122.00');
  expect(await violations(page)).toEqual([]);

  // One fewer M; taking the last XL out removes its line.
  await page.getByTestId('cart-line-1001').getByTestId('cart-fewer').click();
  await page.getByTestId('cart-line-1002').getByTestId('cart-fewer').click();
  await expect(page.getByTestId('cart-line-1002')).toHaveCount(0);
  await page.getByTestId('cart-line-1001').getByTestId('cart-more').click();
  await expect(page.getByTestId('cart-subtotal')).toHaveText('$80.00');

  // The cart is kept in the browser, and the button says how much is in it.
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('cart')).toHaveAccessibleName('Cart, 2 in it');
  await page.getByTestId('cart').click();
  await expect(page.getByTestId('cart-subtotal')).toHaveText('$80.00');

  // Where it is going. A country with states asks for one; the prices come from Printful.
  await page.getByTestId('check-out').click();
  const form = page.getByTestId('address-form');
  await expect(form.getByTestId('address-country')).toHaveValue('US');
  await form.getByTestId('address-name').fill('Pat Drummer');
  await form.getByTestId('address-line1').fill('1 Snare St');
  await form.getByTestId('address-city').fill('Austin');
  await form.getByTestId('address-state').selectOption('TX');
  await form.getByTestId('address-postal-code').fill('78701');
  expect(await violations(page)).toEqual([]);
  await form.getByTestId('address-submit').click();

  // The cheapest way is chosen to begin with; choosing another changes the total.
  await expect(page.getByTestId('shipping-to')).toContainText('Pat Drummer, 1 Snare St, Austin, TX, 78701, United States');
  await expect(page.getByTestId('shipping-STANDARD')).toBeChecked();
  await expect(page.getByTestId('cart-total')).toHaveText('$85.00');
  await page.getByTestId('shipping-EXPRESS').check();
  await expect(page.getByTestId('cart-shipping')).toHaveText('$15.25');
  await expect(page.getByTestId('cart-total')).toHaveText('$95.25');
  expect(await violations(page)).toEqual([]);

  // Changing the address keeps what was typed, and a country without states asks for none.
  await page.getByTestId('change-address').click();
  await expect(form.getByTestId('address-name')).toHaveValue('Pat Drummer');
  await form.getByTestId('address-country').selectOption('DE');
  await expect(form.getByTestId('address-state')).toHaveCount(0);
  await form.getByTestId('address-city').fill('Berlin');
  await form.getByTestId('address-postal-code').fill('10117');
  await form.getByTestId('address-submit').click();
  await expect(page.getByTestId('shipping-to')).toContainText('Berlin, 10117, Germany');
  await expect(page.getByTestId('shipping-EXPRESS')).toHaveCount(0);
  await expect(page.getByTestId('cart-total')).toHaveText('$89.50');

  // Paying goes to Stripe's page; the fake pays at once and sends the buyer back.
  await page.getByTestId('pay').click();
  await expect(page.getByTestId('order-thanks')).toContainText('Thank you');
  expect(new URL(page.url()).search).toBe('');
  await expect(page.getByTestId('cart-empty')).toBeVisible();
  await page.getByTestId('cart-close').click();
  await expect(page.getByTestId('cart')).toHaveAccessibleName('Cart');

  // Printful was asked about the blank garments and the address; Stripe was
  // asked for the catalog's price and Printful's shipping, and for no address.
  const all = await calls(request);
  const quoted = all.filter((call) => call.call === 'rates').at(-1)!.body!;
  expect(quoted.items).toEqual([{ variant_id: 501, quantity: 2 }]);
  expect(quoted.recipient).toMatchObject({ city: 'Berlin', country_code: 'DE', zip: '10117' });
  const asked = all.filter((call) => call.call === 'checkout').at(-1)!.form!;
  expect(asked['line_items[0][price_data][unit_amount]']).toBe('4000');
  expect(asked['line_items[0][quantity]']).toBe('2');
  expect(asked['line_items[0][price_data][product_data][name]']).toBe('Test Hoodie, M');
  expect(asked['shipping_options[0][shipping_rate_data][fixed_amount][amount]']).toBe('950');
  expect(asked['shipping_options[0][shipping_rate_data][display_name]']).toBe('Flat Rate');
  expect(Object.keys(asked).some((key) => key.startsWith('shipping_address_collection'))).toBe(false);
  expect(asked.success_url).toBe(`${ACCOUNTS_URL}/?order=${asked['metadata[order]']}`);
});

test('prices come from the catalog and Printful whatever the request says, and a bad one is refused', async ({ request }) => {
  const before = (await calls(request)).filter((call) => call.call === 'checkout').length;
  await checkout(request, [{ variantId: '1002', quantity: 1, priceCents: 1 }]);
  const asked = (await calls(request)).filter((call) => call.call === 'checkout').at(-1)!.form!;
  expect(asked['line_items[0][price_data][unit_amount]']).toBe('4200');
  expect(asked['shipping_options[0][shipping_rate_data][fixed_amount][amount]']).toBe('500');

  const one = [{ variantId: '1001', quantity: 1 }];
  for (const [what, data, status] of [
    ['an empty cart', { items: [], address: AUSTIN, shippingId: 'STANDARD' }, 400],
    ['too many of one thing', { items: [{ variantId: '1001', quantity: 11 }], address: AUSTIN, shippingId: 'STANDARD' }, 400],
    ['something not for sale', { items: [{ variantId: '9999', quantity: 1 }], address: AUSTIN, shippingId: 'STANDARD' }, 409],
    ['no address', { items: one, shippingId: 'STANDARD' }, 400],
    ['a country not shipped to', { items: one, address: { ...AUSTIN, country: 'FR' }, shippingId: 'STANDARD' }, 400],
    ['a state missing', { items: one, address: { ...AUSTIN, state: null }, shippingId: 'STANDARD' }, 400],
    ['a way of shipping Printful did not offer', { items: one, address: AUSTIN, shippingId: 'TELEPORT' }, 409],
  ] as const) {
    const answer = await request.post('/api/store/checkout', { data, headers: json });
    expect(answer.status(), what).toBe(status);
  }
  expect((await calls(request)).filter((call) => call.call === 'checkout').length).toBe(before + 1);
});

test('shipping is quoted for the address, cheapest first', async ({ request }) => {
  const quote = (address: unknown) =>
    request.post('/api/store/shipping', { data: { items: [{ variantId: '1001', quantity: 1 }], address }, headers: json });
  expect(await (await quote(AUSTIN)).json()).toEqual({
    quotes: [
      { id: 'STANDARD', label: 'Flat Rate', cents: 500, minDays: 4, maxDays: 6 },
      { id: 'EXPRESS', label: 'Express', cents: 1525, minDays: 2, maxDays: 2 },
    ],
  });
  expect((await quote({ ...AUSTIN, country: 'FR' })).status()).toBe(400);
});

test('someone logged in is known to checkout by their address', async ({ request }) => {
  const address = newAddress();
  const signedUp = await request.post('/api/auth/sign-up/email', {
    data: { email: address, password: 'four on the floor', name: '' },
    headers: json,
  });
  expect(signedUp.ok()).toBe(true);
  await request.get(await linkIn(address, /Confirm/));
  await checkout(request, [{ variantId: '1001', quantity: 1 }]);
  expect((await calls(request)).at(-1)!.form!.customer_email).toBe(address);
});

test('a paid order is sent to be printed once, however often Stripe says so', async ({ request }) => {
  const order = await checkout(request, [
    { variantId: '1001', quantity: 2 },
    { variantId: '1002', quantity: 1 },
  ]);

  // Printful fails to confirm: the webhook fails too, so Stripe will try again.
  await request.post(`${FAKE_SERVICES_URL}/fail-next-confirm`);
  expect((await request.post('/api/webhooks/stripe', paidEvent(order))).status()).toBe(500);
  let sent = forOrder(await calls(request), order);
  expect(sent.created).toHaveLength(1);
  expect(sent.confirmed.map((call) => call.failed)).toEqual([true]);

  // The retry confirms the same draft instead of making a second one.
  expect((await request.post('/api/webhooks/stripe', paidEvent(order))).status()).toBe(200);
  sent = forOrder(await calls(request), order);
  expect(sent.created).toHaveLength(1);
  expect(sent.confirmed.map((call) => call.failed)).toEqual([true, false]);

  // Told a third time, there is nothing left to do.
  expect((await request.post('/api/webhooks/stripe', paidEvent(order))).status()).toBe(200);
  sent = forOrder(await calls(request), order);
  expect(sent.created).toHaveLength(1);
  expect(sent.confirmed).toHaveLength(2);

  // What the printer was told: who, where, what, and what the buyer paid.
  const body = sent.created[0]!.body!;
  expect(body.shipping).toBe('STANDARD');
  expect(body.recipient).toMatchObject({
    name: 'Pat Drummer',
    address1: '1 Snare St',
    city: 'Austin',
    state_code: 'TX',
    country_code: 'US',
    zip: '78701',
    email: 'buyer@example.com',
  });
  expect(body.items).toEqual([
    { sync_variant_id: 1001, quantity: 2 },
    { sync_variant_id: 1002, quantity: 1 },
  ]);
  expect(body.retail_costs).toEqual({ subtotal: '122.00', shipping: '5.00', total: '127.00' });
});

test('only Stripe’s own signature sets an order going', async ({ request }) => {
  const order = await checkout(request, [{ variantId: '1001', quantity: 1 }]);
  const event = paidEvent(order);

  const unsigned = await request.post('/api/webhooks/stripe', {
    data: event.data,
    headers: { 'content-type': 'application/json' },
  });
  expect(unsigned.status()).toBe(400);
  expect((await request.post('/api/webhooks/stripe', paidEvent(order, 'someone-elses-secret'))).status()).toBe(400);
  expect(forOrder(await calls(request), order).created).toHaveLength(0);
});

test('Printful’s updates are taken only with the secret in the address', async ({ request }) => {
  const order = await checkout(request, [{ variantId: '1001', quantity: 1 }]);
  const shipped = {
    type: 'package_shipped',
    data: {
      order: { external_id: order.replaceAll('-', '') },
      shipment: { tracking_number: 'TRACK123', tracking_url: 'https://example.com/track/TRACK123' },
    },
  };
  const post = (query: string, data: unknown) =>
    request.post(`/api/webhooks/printful${query}`, { data, headers: { 'content-type': 'application/json' } });

  expect((await post('', shipped)).status()).toBe(403);
  expect((await post('?secret=wrong', shipped)).status()).toBe(403);
  expect((await post(`?secret=${PRINTFUL_WEBHOOK_SECRET}`, { nothing: 'useful' })).status()).toBe(400);
  expect((await post(`?secret=${PRINTFUL_WEBHOOK_SECRET}`, shipped)).status()).toBe(200);
});

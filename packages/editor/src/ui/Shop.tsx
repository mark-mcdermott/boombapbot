import {
  CheckoutAnswerSchema,
  MAX_LINE_QUANTITY,
  QuoteAnswerSchema,
  ShopAnswerSchema,
  formatPrice,
  priceCart,
  shopIsOpen,
  subtotalCents,
  type Address,
  type Country,
  type PricedLine,
  type ShippingQuote,
  type ShopAnswer,
  type ShopProduct,
} from '@boombapbot/contracts';
import { Minus, Plus, ShoppingCart } from 'lucide-react';
import { useEffect, useState, type FormEvent, type RefObject } from 'react';
import { cart, useCart } from '../shop/cart';
import { takeParams } from './arrival';
import { SelectField, TextField } from './fields';
import { Modal } from './Modal';
import { Segmented } from './Segmented';

type Loaded = { state: 'loading' } | { state: 'unreachable' } | { state: 'ready'; shop: ShopAnswer };

async function loadShop(baseUrl: string): Promise<Loaded> {
  try {
    const response = await fetch(`${baseUrl}api/store/catalog`);
    if (!response.ok) return { state: 'unreachable' };
    const answer = ShopAnswerSchema.safeParse(await response.json());
    return answer.success ? { state: 'ready', shop: answer.data } : { state: 'unreachable' };
  } catch {
    return { state: 'unreachable' };
  }
}

/** Sends one request to the shop and returns its answer, or what to tell the buyer. */
async function ask(url: string, body: unknown): Promise<{ answer: unknown } | { problem: string }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const answer: unknown = await response.json();
    if (response.ok) return { answer };
    const message = typeof answer === 'object' && answer !== null ? Reflect.get(answer, 'message') : undefined;
    return { problem: typeof message === 'string' ? message : 'That did not work. Try again in a minute.' };
  } catch {
    return { problem: 'I could not reach the shop. Check your connection and try again.' };
  }
}

const cartItems = (lines: PricedLine[]) =>
  lines.map((line) => ({ variantId: line.variant.id, quantity: line.quantity }));

function Product({ product }: { product: ShopProduct }) {
  const [variantId, setVariantId] = useState(product.variants[0]?.id ?? '');
  const variant = product.variants.find((candidate) => candidate.id === variantId);
  if (!variant) return null;
  return (
    <article className="sb-product" data-testid={`product-${product.id}`}>
      {product.image && <img className="sb-product-image" src={product.image} alt="" width={160} height={160} />}
      <div className="sb-product-body">
        <h3 className="sb-product-name">{product.name}</h3>
        <p className="sb-product-price" data-testid="product-price">
          {formatPrice(variant.priceCents)}
        </p>
        <Segmented
          label={`Size of ${product.name}`}
          value={variantId}
          options={product.variants.map((option) => ({
            value: option.id,
            label: option.label,
            testId: `variant-${option.id}`,
          }))}
          onChange={setVariantId}
        />
        <button className="sb-button" type="button" data-testid="add-to-cart" onClick={() => cart.add(variantId)}>
          Add to cart
        </button>
      </div>
    </article>
  );
}

function Line({ line }: { line: PricedLine }) {
  const { product, variant, quantity } = line;
  const what = `${product.name}, ${variant.label}`;
  return (
    <li className="sb-cart-line" data-testid={`cart-line-${variant.id}`}>
      <span className="sb-cart-what">
        {product.name} <span className="sb-cart-label">{variant.label}</span>
      </span>
      <span className="sb-cart-count">
        <button
          className="sb-icon-button"
          type="button"
          aria-label={quantity === 1 ? `Take ${what} out of the cart` : `One fewer ${what}`}
          data-testid="cart-fewer"
          onClick={() => cart.setQuantity(variant.id, quantity - 1)}
        >
          <Minus />
        </button>
        <span data-testid="cart-quantity" aria-label={`${quantity} of ${what}`}>
          {quantity}
        </span>
        <button
          className="sb-icon-button"
          type="button"
          aria-label={`One more ${what}`}
          data-testid="cart-more"
          disabled={quantity >= MAX_LINE_QUANTITY}
          onClick={() => cart.setQuantity(variant.id, quantity + 1)}
        >
          <Plus />
        </button>
      </span>
      <span className="sb-cart-price">{formatPrice(variant.priceCents * quantity)}</span>
    </li>
  );
}

function Amount({ label, cents, testId }: { label: string; cents: number; testId: string }) {
  return (
    <p className="sb-cart-total">
      <span>{label}</span>
      <strong data-testid={testId}>{formatPrice(cents)}</strong>
    </p>
  );
}

function Problem({ text }: { text: string | null }) {
  return (
    <p className="sb-form-problem" role="alert" data-testid="cart-problem">
      {text}
    </p>
  );
}

function CartLines({ lines, onCheckOut }: { lines: PricedLine[]; onCheckOut(): void }) {
  if (lines.length === 0) {
    return (
      <p className="sb-modal-text" data-testid="cart-empty">
        Your cart is empty.
      </p>
    );
  }
  return (
    <div className="sb-cart" data-testid="cart-lines">
      <ul className="sb-cart-lines">
        {lines.map((line) => (
          <Line key={line.variant.id} line={line} />
        ))}
      </ul>
      <Amount label="Subtotal" cents={subtotalCents(lines)} testId="cart-subtotal" />
      <p className="sb-hint">Shipping depends on where it is going. The next step works it out.</p>
      <button className="sb-button sb-button-primary" type="button" data-testid="check-out" onClick={onCheckOut}>
        Check out
      </button>
    </div>
  );
}

/** The country this browser is set to, if the shop ships there. */
function likelyCountry(countries: Country[]): string {
  const region = new Intl.Locale(navigator.language).region ?? 'US';
  return countries.some((country) => country.code === region) ? region : (countries[0]?.code ?? '');
}

interface AddressFormProps {
  countries: Country[];
  /** What was entered before, when coming back to change it. */
  address: Address | null;
  /** Asks for shipping prices. Returns what went wrong, or null. */
  submit(address: Address): Promise<string | null>;
  onBack(): void;
}

function AddressForm({ countries, address, submit, onBack }: AddressFormProps) {
  const [countryCode, setCountryCode] = useState(() => address?.country ?? likelyCountry(countries));
  const [state, setState] = useState(address?.state ?? '');
  const [waiting, setWaiting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const states = countries.find((country) => country.code === countryCode)?.states ?? [];

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? '').trim();
    setWaiting(true);
    setProblem(null);
    const failed = await submit({
      name: value('name'),
      line1: value('line1'),
      line2: value('line2') || null,
      city: value('city'),
      state: states.length > 0 ? state : null,
      postalCode: value('postalCode'),
      country: countryCode,
    });
    setWaiting(false);
    setProblem(failed);
  };

  return (
    <form className="sb-form" data-testid="address-form" onSubmit={(event) => void onSubmit(event)}>
      <p className="sb-modal-text sb-form-lead">Where is it going? Printful prints it and posts it there.</p>
      <TextField label="Name" name="name" testId="address-name" autoComplete="name" maxLength={100} defaultValue={address?.name} />
      <TextField
        label="Address"
        name="line1"
        testId="address-line1"
        autoComplete="address-line1"
        maxLength={200}
        defaultValue={address?.line1}
      />
      <TextField
        label="Flat, suite, unit (optional)"
        name="line2"
        testId="address-line2"
        autoComplete="address-line2"
        required={false}
        maxLength={200}
        defaultValue={address?.line2 ?? undefined}
      />
      <TextField label="City" name="city" testId="address-city" autoComplete="address-level2" maxLength={100} defaultValue={address?.city} />
      <SelectField
        label="Country"
        name="country"
        testId="address-country"
        autoComplete="country"
        value={countryCode}
        onChange={(code) => {
          setCountryCode(code);
          setState('');
        }}
        options={countries.map((country) => ({ value: country.code, label: country.name }))}
      />
      {states.length > 0 && (
        <SelectField
          label="State or province"
          name="state"
          testId="address-state"
          autoComplete="address-level1"
          value={state}
          onChange={setState}
          placeholder="Choose one"
          options={states.map((option) => ({ value: option.code, label: option.name }))}
        />
      )}
      <TextField
        label="Postal code"
        name="postalCode"
        testId="address-postal-code"
        autoComplete="postal-code"
        maxLength={20}
        defaultValue={address?.postalCode}
      />
      <Problem text={problem} />
      <button className="sb-button sb-button-primary" type="submit" data-testid="address-submit" disabled={waiting}>
        {waiting ? 'Asking Printful…' : 'See shipping prices'}
      </button>
      <p className="sb-account-links">
        <button className="sb-link" type="button" data-testid="back-to-cart" onClick={onBack}>
          Back to the cart
        </button>
      </p>
    </form>
  );
}

function days({ minDays, maxDays }: ShippingQuote): string {
  if (maxDays === 0) return '';
  return minDays === maxDays ? `about ${maxDays} days` : `about ${minDays} to ${maxDays} days`;
}

interface ShippingChoiceProps {
  lines: PricedLine[];
  address: Address;
  countries: Country[];
  quotes: ShippingQuote[];
  /** Starts the payment. Returns what went wrong, or null once the browser is leaving for Stripe. */
  pay(shippingId: string): Promise<string | null>;
  onChangeAddress(): void;
}

function ShippingChoice({ lines, address, countries, quotes, pay, onChangeAddress }: ShippingChoiceProps) {
  const [chosenId, setChosenId] = useState(quotes[0]?.id ?? '');
  const [waiting, setWaiting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const chosen = quotes.find((quote) => quote.id === chosenId);
  const subtotal = subtotalCents(lines);
  const country = countries.find((candidate) => candidate.code === address.country)?.name ?? address.country;
  const where = [address.name, address.line1, address.line2, address.city, address.state, address.postalCode, country]
    .filter(Boolean)
    .join(', ');

  const onPay = async () => {
    setWaiting(true);
    setProblem(null);
    const failed = await pay(chosenId);
    if (failed === null) return;
    setWaiting(false);
    setProblem(failed);
  };

  return (
    <div className="sb-cart" data-testid="shipping-choice">
      <p className="sb-modal-text sb-form-lead" data-testid="shipping-to">
        Going to {where}.{' '}
        <button className="sb-link" type="button" data-testid="change-address" onClick={onChangeAddress}>
          Change
        </button>
      </p>
      <fieldset className="sb-choices">
        <legend className="sb-label">Shipping</legend>
        {quotes.map((quote) => (
          <label key={quote.id} className="sb-choice">
            <input
              type="radio"
              name="shipping"
              value={quote.id}
              data-testid={`shipping-${quote.id}`}
              checked={quote.id === chosenId}
              onChange={() => setChosenId(quote.id)}
            />
            <span className="sb-choice-what">
              {quote.label}
              <span className="sb-cart-label">{days(quote)}</span>
            </span>
            <span className="sb-cart-price">{formatPrice(quote.cents)}</span>
          </label>
        ))}
      </fieldset>
      <Amount label="Subtotal" cents={subtotal} testId="cart-subtotal" />
      <Amount label="Shipping" cents={chosen?.cents ?? 0} testId="cart-shipping" />
      <Amount label="Total" cents={subtotal + (chosen?.cents ?? 0)} testId="cart-total" />
      <Problem text={problem} />
      <button
        className="sb-button sb-button-primary"
        type="button"
        data-testid="pay"
        disabled={waiting || !chosen}
        onClick={() => void onPay()}
      >
        {waiting ? 'Going to Stripe…' : 'Pay on Stripe'}
      </button>
      <p className="sb-hint">
        You pay on Stripe&rsquo;s page. I never see your card. Customs or import tax, where your country charges
        it, is not included.
      </p>
    </div>
  );
}

type Step = { name: 'cart' } | { name: 'address' } | { name: 'shipping'; quotes: ShippingQuote[] };

/** The shop while it is open: browse and fill the cart, then an address, then shipping and payment. */
function OpenShop({ shop, baseUrl }: { shop: ShopAnswer; baseUrl: string }) {
  const lines = priceCart(shop, useCart());
  const [step, setStep] = useState<Step>({ name: 'cart' });
  const [address, setAddress] = useState<Address | null>(null);

  const askForQuotes = async (entered: Address) => {
    const asked = await ask(`${baseUrl}api/store/shipping`, { items: cartItems(lines), address: entered });
    if ('problem' in asked) return asked.problem;
    const answer = QuoteAnswerSchema.safeParse(asked.answer);
    if (!answer.success) return 'I could not read the shipping prices. Try again in a minute.';
    setAddress(entered);
    setStep({ name: 'shipping', quotes: answer.data.quotes });
    return null;
  };

  const pay = async (shippingId: string) => {
    const asked = await ask(`${baseUrl}api/store/checkout`, { items: cartItems(lines), address, shippingId });
    if ('problem' in asked) return asked.problem;
    const answer = CheckoutAnswerSchema.safeParse(asked.answer);
    if (!answer.success) return 'Checkout did not start. Try again in a minute.';
    window.location.assign(answer.data.url);
    return null;
  };

  if (step.name === 'address' && lines.length > 0) {
    return (
      <AddressForm
        countries={shop.countries}
        address={address}
        submit={askForQuotes}
        onBack={() => setStep({ name: 'cart' })}
      />
    );
  }
  if (step.name === 'shipping' && address && lines.length > 0) {
    return (
      <ShippingChoice
        lines={lines}
        address={address}
        countries={shop.countries}
        quotes={step.quotes}
        pay={pay}
        onChangeAddress={() => setStep({ name: 'address' })}
      />
    );
  }
  return (
    <>
      {shop.products.map((product) => (
        <Product key={product.id} product={product} />
      ))}
      <h3 className="sb-label sb-cart-heading">In your cart</h3>
      <CartLines lines={lines} onCheckOut={() => setStep({ name: 'address' })} />
    </>
  );
}

interface ShopProps {
  /** Base URL the site is served from, ending in a slash. */
  baseUrl: string;
  /** Where the modal mounts, so it inherits the page's theme. */
  container: RefObject<HTMLElement | null>;
}

/** The cart button in the footer and its modal: what is for sale, the cart, and the way to checkout. */
export function Shop({ baseUrl, container }: ShopProps) {
  const count = useCart().reduce((sum, line) => sum + line.quantity, 0);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [thanked, setThanked] = useState(false);

  // Back from Stripe: paid, or changed their mind.
  useEffect(() => {
    const arrival = takeParams(['order', 'cart']);
    if (arrival.order) {
      cart.clear();
      setThanked(true);
    }
    if (arrival.order || arrival.cart) setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoaded({ state: 'loading' });
    void loadShop(baseUrl).then((next) => {
      if (current) setLoaded(next);
    });
    return () => {
      current = false;
    };
  }, [open, baseUrl]);

  const body = () => {
    if (loaded.state === 'loading') {
      return (
        <p className="sb-modal-text" role="status">
          Opening the shop…
        </p>
      );
    }
    if (loaded.state === 'unreachable') {
      return (
        <p className="sb-modal-text" data-testid="shop-unreachable">
          I cannot reach the shop right now. The machine does not need it.
        </p>
      );
    }
    if (!loaded.shop.payments || !shopIsOpen(loaded.shop)) {
      return (
        <p className="sb-modal-text" data-testid="shop-closed">
          The shop is not open yet, so there is nothing to put in a cart.
        </p>
      );
    }
    return <OpenShop shop={loaded.shop} baseUrl={baseUrl} />;
  };

  return (
    <Modal
      label={count > 0 ? `Cart, ${count} in it` : 'Cart'}
      title="Shop"
      testId="cart"
      icon={<ShoppingCart />}
      badge={count > 0 ? String(count) : undefined}
      container={container}
      open={open}
      onOpenChange={setOpen}
    >
      {thanked && (
        <div className="sb-notice sb-account-notice" data-kind="ok" data-testid="order-thanks">
          <p role="status">
            Thank you. That went through. Your order gets printed, then posted to the address you gave.
          </p>
        </div>
      )}
      {body()}
    </Modal>
  );
}

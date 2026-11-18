import { LICENSE_KEY_PREFIX, formatPrice, type License, type UpgradeAnswer } from '@boombapbot/contracts';
import { Copy, Sparkles } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { authClient, explain, type Failure } from '../account/client';
import { signedInAccount } from '../account/session';
import { askUpgrade, fetchLicense, redeemKey, remindKey, startCheckout } from '../upgrade/client';
import { takeParams } from './arrival';
import { LinkButton, Problem as SharedProblem, useAttempt } from './attempt';
import { TextField } from './fields';
import { Modal } from './Modal';

type Loaded = { state: 'loading' } | { state: 'unreachable' } | { state: 'ready'; upgrade: UpgradeAnswer };

async function loadUpgrade(baseUrl: string): Promise<Loaded> {
  const asked = await askUpgrade(baseUrl);
  return asked.ok ? { state: 'ready', upgrade: asked.answer } : { state: 'unreachable' };
}

/** How often, and how many times, a buyer just back from Stripe is looked up again while Stripe has yet to say they paid. */
const STRIPE_WAIT_MS = 2000;
const STRIPE_WAIT_TRIES = 15;

const KEY_SHAPE = `${LICENSE_KEY_PREFIX}-XXXXX-XXXXX-XXXXX-XXXXX`;

const Problem = ({ text }: { text: string | null }) => <SharedProblem text={text} testId="upgrade-problem" />;

interface KeyFormProps {
  testId: string;
  action: string;
  busy: string;
  /** The name of the one field in it. */
  field: string;
  /** Returns what went wrong, or null once it worked. */
  submit(value: string): Promise<Failure | null>;
  children: ReactNode;
}

/** A form of one field, for a key or for the address it was bought with. */
function KeyForm({ testId, action, busy, field, submit, children }: KeyFormProps) {
  const { waiting, problem, run } = useAttempt();
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get(field) ?? '').trim();
    void run(() => submit(value));
  };
  return (
    <form className="sb-form" data-testid={testId} onSubmit={onSubmit}>
      {children}
      <Problem text={problem} />
      <button className="sb-button sb-button-primary" type="submit" data-testid="upgrade-submit" disabled={waiting}>
        {waiting ? busy : action}
      </button>
    </form>
  );
}

function Back({ onClick }: { onClick(): void }) {
  return (
    <p className="sb-account-links">
      <LinkButton testId="upgrade-back" onClick={onClick}>
        Back
      </LinkButton>
    </p>
  );
}

function LogInButton({ logIn }: { logIn(): void }) {
  return (
    <div className="sb-form">
      <button className="sb-button sb-button-primary" type="button" data-testid="upgrade-log-in" onClick={logIn}>
        Log in or make an account
      </button>
    </div>
  );
}

/** What the modal has said since before the upgrade could be sold. */
function Closed() {
  return (
    <div data-testid="upgrade-closed">
      <p className="sb-modal-text">
        A one-time upgrade is planned: extra effects beyond the free ones, and a place to show your beats. It is not
        open yet, and nothing can be bought here for now.
      </p>
      <p className="sb-modal-text">Everything on the machine today is free to use, and stays that way.</p>
    </div>
  );
}

interface BuyProps {
  baseUrl: string;
  price: string;
  signedIn: boolean;
  toKey(): void;
  toLost(): void;
}

function Buy({ baseUrl, price, signedIn, toKey, toLost }: BuyProps) {
  const { waiting, problem, run } = useAttempt();
  const [leaving, setLeaving] = useState(false);
  const pay = () =>
    run(async () => {
      const asked = await startCheckout(baseUrl);
      if (!asked.ok) return asked.failure;
      setLeaving(true);
      window.location.assign(asked.answer.url);
      return null;
    });
  return (
    <div data-testid="upgrade-offer">
      <p className="sb-modal-text">
        The upgrade is paid for once. It comes with a license key, which is emailed to you.
      </p>
      <div className="sb-form">
        <p className="sb-cart-total">
          <span>One time</span>
          <strong data-testid="upgrade-price">{price}</strong>
        </p>
        <Problem text={problem} />
        <button
          className="sb-button sb-button-primary"
          type="button"
          data-testid="upgrade-buy"
          disabled={waiting || leaving}
          onClick={() => void pay()}
        >
          {waiting || leaving ? 'Going to Stripe…' : `Pay ${price} on Stripe`}
        </button>
        <p className="sb-hint">
          You pay on Stripe&rsquo;s page. I never see your card.{' '}
          {signedIn ? 'The key goes onto this account as well.' : 'You do not need an account to buy it.'} The{' '}
          <a className="sb-link" href={`${baseUrl}policies`}>
            policies page
          </a>{' '}
          says what I keep.
        </p>
      </div>
      <p className="sb-account-links">
        <LinkButton testId="upgrade-to-key" onClick={toKey}>
          I have a key
        </LinkButton>
        <LinkButton testId="upgrade-to-lost" onClick={toLost}>
          I lost my key
        </LinkButton>
      </p>
    </div>
  );
}

interface EnterKeyProps {
  baseUrl: string;
  signedIn: boolean;
  logIn(): void;
  redeemed(): void;
  back(): void;
}

function EnterKey({ baseUrl, signedIn, logIn, redeemed, back }: EnterKeyProps) {
  if (!signedIn) {
    return (
      <div data-testid="upgrade-key-needs-account">
        <p className="sb-modal-text">
          A key goes onto an account, so log in or make one first. Then come back here and enter it.
        </p>
        <LogInButton logIn={logIn} />
        <Back onClick={back} />
      </div>
    );
  }
  return (
    <>
      <KeyForm
        testId="upgrade-key-form"
        action="Use this key"
        busy="Checking it…"
        field="key"
        submit={async (key) => {
          const asked = await redeemKey(baseUrl, key);
          if (!asked.ok) return asked.failure;
          redeemed();
          return null;
        }}
      >
        <p className="sb-modal-text sb-form-lead">Enter the key from your email and it goes onto this account.</p>
        <TextField
          label="License key"
          name="key"
          testId="upgrade-key-input"
          autoComplete="off"
          maxLength={80}
          hint={`It looks like ${KEY_SHAPE}.`}
        />
      </KeyForm>
      <Back onClick={back} />
    </>
  );
}

function LostKey({ baseUrl, sent, back }: { baseUrl: string; sent(email: string): void; back(): void }) {
  return (
    <>
      <KeyForm
        testId="upgrade-lost-form"
        action="Email my key"
        busy="Sending…"
        field="email"
        submit={async (email) => {
          const asked = await remindKey(baseUrl, email);
          if (!asked.ok) return asked.failure;
          sent(email);
          return null;
        }}
      >
        <p className="sb-modal-text sb-form-lead">
          Tell me the address you bought it with and I will email its key there again.
        </p>
        <TextField label="Email" name="email" type="email" testId="upgrade-email" autoComplete="email" maxLength={320} />
      </KeyForm>
      <Back onClick={back} />
    </>
  );
}

function KeySent({ email, back }: { email: string; back(): void }) {
  return (
    <div data-testid="upgrade-key-sent">
      <p className="sb-modal-text">
        If <strong>{email}</strong> bought the upgrade, its key is on its way there. A key goes out at most once in
        ten minutes, so one that was just sent will not come twice.
      </p>
      <Back onClick={back} />
    </div>
  );
}

type View = { name: 'buy' } | { name: 'key' } | { name: 'lost' } | { name: 'sent'; email: string };

interface OfferProps {
  baseUrl: string;
  upgrade: UpgradeAnswer;
  signedIn: boolean;
  logIn(): void;
  redeemed(): void;
}

/** The upgrade while it is for sale: buy it, enter a key bought earlier, or ask for a lost one. */
function Offer({ baseUrl, upgrade, signedIn, logIn, redeemed }: OfferProps) {
  const [view, setView] = useState<View>({ name: 'buy' });
  const back = () => setView({ name: 'buy' });
  switch (view.name) {
    case 'buy':
      return (
        <Buy
          baseUrl={baseUrl}
          price={formatPrice(upgrade.priceCents)}
          signedIn={signedIn}
          toKey={() => setView({ name: 'key' })}
          toLost={() => setView({ name: 'lost' })}
        />
      );
    case 'key':
      return <EnterKey baseUrl={baseUrl} signedIn={signedIn} logIn={logIn} redeemed={redeemed} back={back} />;
    case 'lost':
      return <LostKey baseUrl={baseUrl} sent={(email) => setView({ name: 'sent', email })} back={back} />;
    case 'sent':
      return <KeySent email={view.email} back={back} />;
  }
}

interface JustPaidProps {
  signedIn: boolean;
  /** Whether Stripe is still being waited on. */
  waiting: boolean;
  logIn(): void;
}

/** Back from Stripe with the money taken, before the key is on an account. Nothing here sells it again. */
function JustPaid({ signedIn, waiting, logIn }: JustPaidProps) {
  if (!signedIn) {
    return (
      <div data-testid="upgrade-paid">
        <p className="sb-modal-text">
          To put the key on an account, log in or make one. Then open this again and choose &ldquo;I have a
          key&rdquo;.
        </p>
        <LogInButton logIn={logIn} />
      </div>
    );
  }
  return (
    <p className="sb-modal-text" role="status" data-testid="upgrade-waiting">
      {waiting
        ? 'The key goes onto this account as well. I am waiting to hear from Stripe, which can take a minute.'
        : 'Stripe has not told me yet. The key still comes by email. Close this and open it again in a minute.'}
    </p>
  );
}

type Held = { state: 'loading' } | { state: 'failed'; problem: string } | { state: 'ready'; license: License };

/** An upgraded account's key, to read or to copy. */
function Upgraded({ baseUrl }: { baseUrl: string }) {
  const [held, setHeld] = useState<Held>({ state: 'loading' });
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void fetchLicense(baseUrl).then((asked) => {
      if (!current) return;
      setHeld(
        asked.ok
          ? { state: 'ready', license: asked.answer.license }
          : { state: 'failed', problem: explain(asked.failure) },
      );
    });
    return () => {
      current = false;
    };
  }, [baseUrl]);

  const copy = (key: string) =>
    navigator.clipboard.writeText(key).then(
      () => setCopied('Copied.'),
      () => setCopied('I could not copy it. Select the key and copy it by hand.'),
    );

  return (
    <div data-testid="upgrade-upgraded">
      <p className="sb-modal-text">This account is upgraded. This is its license key.</p>
      {held.state === 'loading' && (
        <p className="sb-modal-text" role="status">
          Fetching the key…
        </p>
      )}
      {held.state === 'failed' && (
        <div className="sb-form">
          <Problem text={held.problem} />
        </div>
      )}
      {held.state === 'ready' && (
        <div className="sb-form">
          <div className="sb-license">
            <code className="sb-license-key" data-testid="upgrade-key">
              {held.license.key}
            </code>
            <button
              className="sb-button"
              type="button"
              data-testid="upgrade-copy"
              onClick={() => void copy(held.license.key)}
            >
              <Copy aria-hidden="true" />
              Copy
            </button>
          </div>
          <p className="sb-hint" role="status" data-testid="upgrade-copied">
            {copied}
          </p>
          <p className="sb-hint">
            It was emailed when it was bought, too. If this account is ever deleted the key is not: it can go onto
            another account.
          </p>
        </div>
      )}
    </div>
  );
}

function Unreachable() {
  return (
    <p className="sb-modal-text" data-testid="upgrade-unreachable">
      I cannot reach the server right now, so I cannot say anything about the upgrade. The machine does not need
      it.
    </p>
  );
}

interface UpgradeProps {
  /** Base URL the site is served from, ending in a slash. */
  baseUrl: string;
  /** Where the modal mounts, so it inherits the page's theme. */
  container: RefObject<HTMLElement | null>;
  /** Opens the account modal, for somebody who needs an account to put a key on. */
  logIn(): void;
}

/**
 * The upgrade button in the footer and its modal: what it costs and the way
 * to pay, a key to enter or ask for again, and an upgraded account's key.
 * While the server says it is closed, the modal only says so.
 */
export function Upgrade({ baseUrl, container, logIn }: UpgradeProps) {
  const session = authClient().useSession();
  const account = signedInAccount(session.data);
  const accountId = account?.id ?? null;
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [justPaid, setJustPaid] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  // Back from Stripe: paid, or changed their mind.
  useEffect(() => {
    const arrival = takeParams(['upgrade']).upgrade;
    if (arrival === 'paid') setJustPaid(true);
    if (arrival === 'paid' || arrival === 'open') setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoaded({ state: 'loading' });
    void loadUpgrade(baseUrl).then((next) => {
      if (current) setLoaded(next);
    });
    return () => {
      current = false;
    };
  }, [open, baseUrl, accountId]);

  const upgrade = loaded.state === 'ready' ? loaded.upgrade : null;
  const awaitingStripe = open && justPaid && accountId !== null && upgrade !== null && !upgrade.upgraded;
  const stillWaiting = awaitingStripe && tries < STRIPE_WAIT_TRIES;

  // Stripe sends the buyer back and tells the server they paid as two separate
  // things, in either order. Somebody back first is looked up again for a while.
  useEffect(() => {
    if (!stillWaiting) return;
    let current = true;
    const timer = window.setTimeout(() => {
      void loadUpgrade(baseUrl).then((next) => {
        if (!current) return;
        if (next.state === 'ready') setLoaded(next);
        setTries((count) => count + 1);
      });
    }, STRIPE_WAIT_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [stillWaiting, tries, baseUrl]);

  // Opened from its button, it starts over; opened by coming back from Stripe, it keeps what that said.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setJustPaid(false);
      setNotice(null);
      setTries(0);
    }
    setOpen(next);
  };

  const toAccount = () => {
    setOpen(false);
    logIn();
  };

  const body = () => {
    if (loaded.state === 'unreachable') return <Unreachable />;
    if (!upgrade || session.isPending) {
      return (
        <p className="sb-modal-text" role="status">
          Asking about the upgrade…
        </p>
      );
    }
    if (upgrade.upgraded) return <Upgraded baseUrl={baseUrl} />;
    if (justPaid) return <JustPaid signedIn={accountId !== null} waiting={stillWaiting} logIn={toAccount} />;
    if (!upgrade.open) return <Closed />;
    return (
      <Offer
        baseUrl={baseUrl}
        upgrade={upgrade}
        signedIn={accountId !== null}
        logIn={toAccount}
        redeemed={() => {
          setNotice('That key is on this account now.');
          setLoaded({ state: 'ready', upgrade: { ...upgrade, upgraded: true } });
        }}
      />
    );
  };

  return (
    <Modal
      label="Upgrade"
      title="Upgrade"
      testId="upgrade"
      className="sb-ico-upgrade"
      icon={<Sparkles />}
      container={container}
      open={open}
      onOpenChange={onOpenChange}
    >
      {justPaid && (
        <div className="sb-notice sb-account-notice" data-kind="ok" data-testid="upgrade-thanks">
          <p role="status">Thank you. That went through. Your license key is on its way by email.</p>
        </div>
      )}
      {notice && (
        <div className="sb-notice sb-account-notice" data-kind="ok" data-testid="upgrade-notice">
          <p role="status">{notice}</p>
        </div>
      )}
      {body()}
    </Modal>
  );
}

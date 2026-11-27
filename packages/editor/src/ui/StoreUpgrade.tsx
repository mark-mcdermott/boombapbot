import { Sparkles } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import { authClient, draftKeeper } from '../account/client';
import { signedInAccount } from '../account/session';
import { useDeviceLicenseSource, type LicenseSource } from '../upgrade/device-license';
import { syncWithStore, unlockWithPurchase, type StoreBridge } from '../upgrade/store';
import { LinkButton, Problem, useAttempt } from './attempt';
import { Modal } from './Modal';
import { PAID_EFFECTS } from './Upgrade';

type Listing = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; price: string };

async function listing(store: StoreBridge): Promise<Listing> {
  try {
    const product = await store.product();
    return product ? { state: 'ready', price: product.price } : { state: 'missing' };
  } catch (error) {
    console.error('The store could not be asked about the upgrade.', error);
    return { state: 'missing' };
  }
}

const STORE_FAILED = { message: 'The store did not finish that. Nothing was charged that it did not say so. Try again.' };
const NOTHING_TO_RESTORE = { message: 'The store has no purchase of the upgrade for this account of yours.' };
const WAITING_ON_APPROVAL = {
  message: 'The purchase is waiting to be approved. The upgrade unlocks here once it is.',
};

/** What a device that holds the upgrade is told, by how it came to. */
function Unlocked({ source, signedIn, logIn }: { source: LicenseSource; signedIn: boolean; logIn(): void }) {
  return (
    <div data-testid="upgrade-unlocked">
      <p className="sb-modal-text">
        The upgrade is unlocked on {draftKeeper()}: the machine has all ten effects, offline too.
      </p>
      {source === 'account' && (
        <p className="sb-modal-text">It came with the account that is logged in. Logging out locks it here again.</p>
      )}
      {source === 'store' && !signedIn && (
        <>
          <p className="sb-modal-text">
            It is yours on this phone. To have it on the boombapbot site and in the desktop app as well, log in to an
            account here and it goes onto that account.
          </p>
          <div className="sb-form">
            <button className="sb-button" type="button" data-testid="upgrade-log-in" onClick={logIn}>
              Log in or make an account
            </button>
          </div>
        </>
      )}
      {source === 'store' && signedIn && (
        <p className="sb-modal-text">Wherever this account is logged in, the machine has them too.</p>
      )}
    </div>
  );
}

interface OfferProps {
  serverUrl: string;
  store: StoreBridge;
  listing: Listing;
}

function Offer({ serverUrl, store, listing }: OfferProps) {
  const { waiting, problem, run } = useAttempt();
  const buy = () =>
    run(async () => {
      try {
        const bought = await store.buy();
        if ('purchase' in bought) return await unlockWithPurchase(serverUrl, bought.purchase);
        return bought.stopped === 'pending' ? WAITING_ON_APPROVAL : null;
      } catch (error) {
        console.error('The store could not finish the purchase.', error);
        return STORE_FAILED;
      }
    });
  const restore = () =>
    run(async () => {
      try {
        const { held, failure } = await syncWithStore(serverUrl, store, true);
        return held ? failure : NOTHING_TO_RESTORE;
      } catch (error) {
        console.error('The store could not be asked for purchases.', error);
        return STORE_FAILED;
      }
    });
  const price = listing.state === 'ready' ? listing.price : null;
  return (
    <div data-testid="upgrade-offer">
      <p className="sb-modal-text">
        The upgrade adds six effects to the machine: {PAID_EFFECTS}. You pay for it once, and the four effects the
        machine has stay free.
      </p>
      <div className="sb-form">
        {price && (
          <p className="sb-cart-total">
            <span>One time</span>
            <strong data-testid="upgrade-price">{price}</strong>
          </p>
        )}
        {listing.state === 'missing' && (
          <p className="sb-hint" role="status" data-testid="upgrade-no-listing">
            I cannot reach the store right now, so it cannot be bought this minute.
          </p>
        )}
        <Problem text={problem} testId="upgrade-problem" />
        <button
          className="sb-button sb-button-primary"
          type="button"
          data-testid="upgrade-buy"
          disabled={waiting || !price}
          onClick={() => void buy()}
        >
          {waiting ? 'Asking the store…' : price ? `Buy for ${price}` : 'Buy'}
        </button>
        <p className="sb-hint">
          The store takes the payment. You do not need an account to buy it. If a boombapbot account of yours
          already has the upgrade, logging in to it unlocks it here.
        </p>
      </div>
      <p className="sb-account-links">
        <LinkButton testId="upgrade-restore" onClick={() => void restore()}>
          Restore purchases
        </LinkButton>
      </p>
    </div>
  );
}

interface StoreUpgradeProps {
  /** The site's address, ending in a slash: its server makes the license. */
  serverUrl: string;
  store: StoreBridge;
  /** Where the modal mounts, so it inherits the page's theme. */
  container: RefObject<HTMLElement | null>;
  /** Opens the account modal. */
  logIn(): void;
}

/**
 * The upgrade in an app that sells it through the phone's store: the price
 * as the store gives it, the store's own way to pay, and a way to get back
 * a purchase made before. It takes no license key and names nowhere else to
 * pay, which is what the stores ask of an app.
 *
 * Mounted, it keeps the device in step with the store whenever the app
 * opens or somebody logs in, so a purchase finds its way onto an account
 * and a refund locks the device again.
 */
export function StoreUpgrade({ serverUrl, store, container, logIn }: StoreUpgradeProps) {
  const source = useDeviceLicenseSource();
  const accountId = signedInAccount(authClient().useSession().data)?.id ?? null;
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState<Listing>({ state: 'loading' });

  useEffect(() => {
    const sync = () =>
      void syncWithStore(serverUrl, store).catch((error: unknown) =>
        console.error('The store could not be asked for purchases.', error),
      );
    sync();
    return store.watch?.(sync);
  }, [serverUrl, store, accountId]);

  useEffect(() => {
    if (!open || source) return;
    let current = true;
    setListed({ state: 'loading' });
    void listing(store).then((next) => {
      if (current) setListed(next);
    });
    return () => {
      current = false;
    };
  }, [open, source, store]);

  const toAccount = () => {
    setOpen(false);
    logIn();
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
      onOpenChange={setOpen}
    >
      {source ? (
        <Unlocked source={source} signedIn={accountId !== null} logIn={toAccount} />
      ) : listed.state === 'loading' ? (
        <p className="sb-modal-text" role="status">
          Asking the store…
        </p>
      ) : (
        <Offer serverUrl={serverUrl} store={store} listing={listed} />
      )}
    </Modal>
  );
}

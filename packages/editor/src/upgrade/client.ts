import {
  CheckoutAnswerSchema,
  LicenseAnswerSchema,
  LicenseFileAnswerSchema,
  UpgradeAnswerSchema,
  UpgradeRefusalSchema,
  type License,
  type LicenseFileAnswer,
  type StorePurchaseRequest,
  type UpgradeAnswer,
  type UpgradeRefusal,
} from '@boombapbot/contracts';
import { ANY_ANSWER, ask as askServer, type Asked as AskedOf, type Reader } from '../account/ask';
import { UNREACHABLE, type Failure } from '../account/client';

// The one-time upgrade and its license key. Every call here is started by
// the upgrade's modal; the machine never waits on one.

export interface UpgradeFailure extends Failure {
  code?: UpgradeRefusal | typeof UNREACHABLE.code;
}

export type Asked<Answer> = AskedOf<Answer, UpgradeFailure>;

const ask = <Answer>(url: string, reader: Reader<Answer>, method?: string, body?: unknown): Promise<Asked<Answer>> =>
  askServer(url, reader, UpgradeRefusalSchema, method, body);

const address = (baseUrl: string, path = '') => `${baseUrl}api/upgrade${path}`;

/** Whether it is for sale, what it costs, and whether the account that is logged in has it. */
export function askUpgrade(baseUrl: string): Promise<Asked<UpgradeAnswer>> {
  return ask(address(baseUrl), UpgradeAnswerSchema);
}

/** Starts a payment and answers with the address of Stripe's page for it. */
export function startCheckout(baseUrl: string): Promise<Asked<{ url: string }>> {
  return ask(address(baseUrl, '/checkout'), CheckoutAnswerSchema, 'POST');
}

/** The license of the account that is logged in. */
export function fetchLicense(baseUrl: string): Promise<Asked<{ license: License }>> {
  return ask(address(baseUrl, '/key'), LicenseAnswerSchema);
}

/** A signed license file for the account that is logged in, to keep on this device. */
export function fetchLicenseFile(baseUrl: string): Promise<Asked<LicenseFileAnswer>> {
  return ask(address(baseUrl, '/license'), LicenseFileAnswerSchema);
}

/** A signed license file for a key alone, with nobody logged in. The key stays on whatever account it is on. */
export function fetchLicenseFileForKey(baseUrl: string, key: string): Promise<Asked<LicenseFileAnswer>> {
  return ask(address(baseUrl, '/license'), LicenseFileAnswerSchema, 'POST', { key });
}

/**
 * A signed license file for a purchase made in a store app, as the store
 * signed it. It goes onto the account that is logged in, if there is one.
 */
export function fetchLicenseFileForPurchase(baseUrl: string, purchase: StorePurchaseRequest): Promise<Asked<LicenseFileAnswer>> {
  return ask(address(baseUrl, '/store'), LicenseFileAnswerSchema, 'POST', purchase);
}

/** Puts a key bought without an account onto the account that is logged in. */
export function redeemKey(baseUrl: string, key: string): Promise<Asked<unknown>> {
  return ask(address(baseUrl, '/redeem'), ANY_ANSWER, 'POST', { key });
}

/** Asks for the keys bought with an address to be emailed to it again. */
export function remindKey(baseUrl: string, email: string): Promise<Asked<unknown>> {
  return ask(address(baseUrl, '/key'), ANY_ANSWER, 'POST', { email });
}

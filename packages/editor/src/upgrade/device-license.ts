import { useSyncExternalStore } from 'react';
import { LICENSE_PUBLIC_KEY, unlocksUpgrade, verifyLicenseFile } from '@boombapbot/contracts';
import { browserStorage, type KeyValueStorage } from '../state/draft-storage';
import { fetchLicenseFile, fetchLicenseFileForKey, type UpgradeFailure } from './client';

export const LICENSE_FILE_KEY = 'boombapbot.license.v1';
export const LICENSE_SOURCE_KEY = 'boombapbot.license.source.v1';

/**
 * How a device came by its license file. `account`: somebody upgraded was
 * logged in, and the device is locked again when nobody is. `key`: a key was
 * typed here, and the device stays unlocked until the key is removed from it.
 */
export type LicenseSource = 'account' | 'key';

/**
 * The license file this device holds, and whether it pays for the upgrade.
 * The file is kept as the server gave it and checked here, against the key
 * built into the program, with no server asked, so a device that has one is
 * upgraded offline. Kept in the browser beside the draft; with no storage it
 * lasts until the page is closed.
 */
export class DeviceLicense {
  private held: LicenseSource | null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: KeyValueStorage | null,
    private readonly publicKey: string = LICENSE_PUBLIC_KEY,
  ) {
    // A file with nothing to say how it came is taken for an account's, the kind that a log-out takes away.
    this.held = this.pays(this.read(LICENSE_FILE_KEY)) ? (this.read(LICENSE_SOURCE_KEY) === 'key' ? 'key' : 'account') : null;
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private pays(file: string | null): boolean {
    return file !== null && unlocksUpgrade(verifyLicenseFile(file, this.publicKey));
  }

  private become(next: LicenseSource | null): void {
    if (this.held === next) return;
    this.held = next;
    for (const listener of this.listeners) listener();
  }

  /** Whether the file held here is a good one that unlocks the upgrade. */
  get upgraded(): boolean {
    return this.held !== null;
  }

  /** How the device came by the file that unlocks it, or null while it is locked. */
  get source(): LicenseSource | null {
    return this.held;
  }

  /**
   * Takes a file the server gave. A file that does not check out is not
   * kept, so nothing a server says can take away an upgrade this device
   * already holds. A device unlocked by a key stays a key's, whoever logs
   * in after. True when the device is upgraded by it.
   */
  keep(file: string, source: LicenseSource): boolean {
    if (!this.pays(file)) return false;
    const next = this.held === 'key' ? 'key' : source;
    try {
      this.storage?.setItem(LICENSE_FILE_KEY, file);
      this.storage?.setItem(LICENSE_SOURCE_KEY, next);
    } catch {
      // Storage is full or blocked. The upgrade still holds for this visit.
    }
    this.become(next);
    return true;
  }

  private forget(): void {
    try {
      this.storage?.removeItem(LICENSE_FILE_KEY);
      this.storage?.removeItem(LICENSE_SOURCE_KEY);
    } catch {
      // Storage is blocked. The device is locked for this visit all the same.
    }
    this.become(null);
  }

  /** Nobody is logged in any more: a device an account unlocked is locked again. A key's is left alone. */
  loggedOut(): void {
    if (this.held === 'account') this.forget();
  }

  /** Takes the typed key's file off the device. Whoever is logged in and upgraded unlocks it again. */
  removeKey(): void {
    if (this.held === 'key') this.forget();
  }

  /** Tells `listener` when the device is unlocked or locked. Returns the way to stop. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

let device: DeviceLicense | null = null;

/** The license kept in this browser, read and checked once per page. */
export function deviceLicense(): DeviceLicense {
  device ??= new DeviceLicense(browserStorage());
  return device;
}

/** Whether this device holds the upgrade, following the moment it is unlocked or locked. */
export function useDeviceUpgraded(): boolean {
  return useDeviceLicenseSource() !== null;
}

/** How this device was unlocked, or null while it is locked. */
export function useDeviceLicenseSource(): LicenseSource | null {
  const license = deviceLicense();
  const read = () => license.source;
  return useSyncExternalStore(license.subscribe, read, read);
}

/**
 * Asks the server for the file of the account that is logged in, unless this
 * device already holds a good one. An account that has not upgraded, or a
 * server that cannot be reached, leaves the device as it was: the machine
 * never waits on this, and it is asked again the next time somebody logs in.
 * `wanted` is asked once the answer is in, so a file that arrives after its
 * account has logged out is not kept.
 */
export async function fetchDeviceLicense(
  baseUrl: string,
  wanted: () => boolean = () => true,
  license: DeviceLicense = deviceLicense(),
): Promise<void> {
  if (license.upgraded) return;
  const asked = await fetchLicenseFile(baseUrl);
  if (asked.ok && wanted()) license.keep(asked.answer.file, 'account');
}

const NOT_FOR_THIS_PROGRAM: UpgradeFailure = {
  message: 'The server gave a license file this program does not accept. Update it, or try again in a minute.',
};

/**
 * Unlocks this device with a typed key and nobody logged in. Returns what
 * went wrong, or null once the device holds the key's file.
 */
export async function unlockWithKey(
  baseUrl: string,
  key: string,
  license: DeviceLicense = deviceLicense(),
): Promise<UpgradeFailure | null> {
  const asked = await fetchLicenseFileForKey(baseUrl, key);
  if (!asked.ok) return asked.failure;
  return license.keep(asked.answer.file, 'key') ? null : NOT_FOR_THIS_PROGRAM;
}

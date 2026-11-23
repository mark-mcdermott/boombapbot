import { useSyncExternalStore } from 'react';
import { LICENSE_PUBLIC_KEY, unlocksUpgrade, verifyLicenseFile } from '@boombapbot/contracts';
import { browserStorage, type KeyValueStorage } from '../state/draft-storage';
import { fetchLicenseFile } from './client';

export const LICENSE_FILE_KEY = 'boombapbot.license.v1';

/**
 * The license file this device holds, and whether it pays for the upgrade.
 * The file is kept as the server gave it and checked here, against the key
 * built into the program, with no server asked: a device that has one is
 * upgraded offline, and stays so after a log-out, since a file does not run
 * out. Kept in the browser beside the draft; with no storage it lasts until
 * the page is closed.
 */
export class DeviceLicense {
  private file: string | null;
  private held: boolean;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: KeyValueStorage | null,
    private readonly publicKey: string = LICENSE_PUBLIC_KEY,
  ) {
    this.file = this.read();
    this.held = this.pays(this.file);
  }

  private read(): string | null {
    try {
      return this.storage?.getItem(LICENSE_FILE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private pays(file: string | null): boolean {
    return file !== null && unlocksUpgrade(verifyLicenseFile(file, this.publicKey));
  }

  /** Whether the file held here is a good one that unlocks the upgrade. */
  get upgraded(): boolean {
    return this.held;
  }

  /**
   * Takes a file the server gave. A file that does not check out is not
   * kept, so nothing a server says can take away an upgrade this device
   * already holds. True when the device is upgraded by it.
   */
  keep(file: string): boolean {
    if (!this.pays(file)) return false;
    this.file = file;
    try {
      this.storage?.setItem(LICENSE_FILE_KEY, file);
    } catch {
      // Storage is full or blocked. The upgrade still holds for this visit.
    }
    if (!this.held) {
      this.held = true;
      for (const listener of this.listeners) listener();
    }
    return true;
  }

  /** Tells `listener` when the device becomes upgraded. Returns the way to stop. */
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

/** Whether this device holds the upgrade, following the moment a file arrives. */
export function useDeviceUpgraded(): boolean {
  const license = deviceLicense();
  const read = () => license.upgraded;
  return useSyncExternalStore(license.subscribe, read, read);
}

/**
 * Asks the server for the file of the account that is logged in, unless this
 * device already holds a good one. An account that has not upgraded, or a
 * server that cannot be reached, leaves the device as it was: the machine
 * never waits on this, and it is asked again the next time somebody logs in.
 */
export async function fetchDeviceLicense(baseUrl: string, license: DeviceLicense = deviceLicense()): Promise<void> {
  if (license.upgraded) return;
  const asked = await fetchLicenseFile(baseUrl);
  if (asked.ok) license.keep(asked.answer.file);
}

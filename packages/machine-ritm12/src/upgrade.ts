import { deviceLicense, useDeviceUpgraded } from '@boombapbot/editor';

/**
 * Whether this program holds the upgrade, which is what lets it play the six
 * effects that come with it: it does once the device keeps a license file
 * that checks out against the key built into the program, with no server
 * asked.
 */
export function holdsUpgrade(): boolean {
  return deviceLicense().upgraded;
}

/** The same, for a panel: it follows the moment a license file arrives. */
export const useHoldsUpgrade = useDeviceUpgraded;

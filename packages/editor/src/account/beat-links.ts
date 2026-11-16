import { browserStorage, type KeyValueStorage } from '../state/draft-storage';

export const BEAT_LINKS_KEY = 'boombapbot.beats.v1';

/** The saved beat a project on this device goes with, and when that copy was saved. */
export interface BeatLink {
  beat: string;
  seen: string;
}

/** By account, then by project id. */
type Links = Record<string, Record<string, BeatLink>>;

function isLink(value: unknown): value is BeatLink {
  if (typeof value !== 'object' || value === null) return false;
  const { beat, seen } = value as Partial<BeatLink>;
  return typeof beat === 'string' && typeof seen === 'string' && !Number.isNaN(Date.parse(seen));
}

function readLinks(text: string | null): Links {
  if (!text) return {};
  let stored: unknown;
  try {
    stored = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof stored !== 'object' || stored === null) return {};
  const links: Links = {};
  for (const [account, projects] of Object.entries(stored)) {
    if (typeof projects !== 'object' || projects === null) continue;
    links[account] = Object.fromEntries(
      Object.entries(projects).filter((entry): entry is [string, BeatLink] => isLink(entry[1])),
    );
  }
  return links;
}

/**
 * What this device remembers about the account's saved beats: which one the
 * project on the machine was last loaded from or saved to, and when that copy
 * was saved. A save replaces that beat, and the time is what tells the server
 * whether another device has saved since. Kept in the browser beside the
 * draft; with no storage it lasts until the page is closed.
 */
export class BeatLinks {
  private links: Links;

  constructor(private readonly storage: KeyValueStorage | null) {
    this.links = readLinks(this.read());
  }

  private read(): string | null {
    try {
      return this.storage?.getItem(BEAT_LINKS_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private write(account: string, projects: Record<string, BeatLink>): void {
    this.links = { ...this.links, [account]: projects };
    try {
      this.storage?.setItem(BEAT_LINKS_KEY, JSON.stringify(this.links));
    } catch {
      // Storage is full or blocked. The links still hold for this visit.
    }
  }

  get(account: string, projectId: string): BeatLink | null {
    return this.links[account]?.[projectId] ?? null;
  }

  set(account: string, projectId: string, link: BeatLink): void {
    this.write(account, { ...this.links[account], [projectId]: link });
  }

  /** Drops what was remembered about every beat the account no longer holds. */
  keepOnly(account: string, beats: readonly string[]): void {
    const projects = Object.entries(this.links[account] ?? {});
    const kept = projects.filter(([, link]) => beats.includes(link.beat));
    if (kept.length < projects.length) this.write(account, Object.fromEntries(kept));
  }
}

let device: BeatLinks | null = null;

/** The links kept in this browser, read once per page. */
export function deviceBeatLinks(): BeatLinks {
  device ??= new BeatLinks(browserStorage());
  return device;
}

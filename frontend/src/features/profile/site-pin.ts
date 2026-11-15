import { useSyncExternalStore } from "react";

/*
 * A read-only view of the site pin that does not import the profile store. The worker layout's header needs only the two
 * fields (which site, which crew) to name the site; reading them through `useProfile` would put zustand's persist middleware,
 * `revoke` and the whole store into the layout chunk of every worker page (about 6.6 KB gzip of a 170 KB budget, F2 Part 0).
 * The store stays where something writes or revokes: the Today view and the Alerts page.
 *
 * Two inputs, one truth. The store PUBLISHES the pin after it changes it (`publishSitePin`, called by chooseSite, clearSite and
 * revoke), which also covers a phone whose localStorage is blocked (the store then keeps the pin in memory only). Until the
 * store has spoken, and after another tab changed the stored value (a `storage` event drops what was published), the pin is
 * read from localStorage with the same validation the store applies.
 */

/** The localStorage key of the profile store (zustand persist): one JSON value that holds the profile, the push registration and the pin. */
export const PROFILE_STORAGE_KEY = "sb-profile-v1";

/**
 * The site's two call numbers, kept on the phone for the unwell sheet (F2 Task 18). They are the SITE's, the same for every
 * worker, and not personal data; they are stored here, at pin time, so the sheet can ring offline after one visit. A field is
 * null when the site has no such number: the sheet then shows a designed row, never an empty `tel:`.
 */
export interface SiteContacts {
  readonly supervisorPhone: string | null;
  readonly firstAiderPhone: string | null;
  /**
   * When the phone last wrote or changed these numbers (an ISO instant), so that the sheet can say "Numbers saved on 12 Nov"
   * when it is offline: a number that may be old should look old. Absent on a pin written before this field existed.
   */
  readonly savedAt?: string;
}

/**
 * Which site, and optionally which crew, this phone is pinned to. Chosen on the phone; the API never hears of it.
 * `contacts` is absent until the phone has seen the site's record (the sheet then says to open Today once); a pin written
 * before contacts existed, or with a value of the wrong shape, reads as absent.
 */
export interface SitePin {
  readonly siteId: string;
  readonly crewId: string | null;
  readonly contacts?: SiteContacts;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** E.164: a plus, a non-zero first digit, 7 to 15 digits in all. Anything else is never put in a `tel:` link. */
const E164 = /^\+[1-9]\d{6,14}$/;

/** `value` when it is an E.164 number, else null. */
export function toE164(value: unknown): string | null {
  return typeof value === "string" && E164.test(value) ? value : null;
}

/**
 * Contacts from a stored or fetched value: both keys must be present (a string or null); a string that is not E.164 reads as
 * null for that field. A value that is not an object with both keys is "never learned" (undefined), not "the site has none".
 */
export function toSiteContacts(value: unknown): SiteContacts | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { supervisorPhone, firstAiderPhone, savedAt } = value as Record<string, unknown>;
  const ok = (field: unknown) => field === null || typeof field === "string";
  if (!ok(supervisorPhone) || !ok(firstAiderPhone)) return undefined;
  const numbers = { supervisorPhone: toE164(supervisorPhone), firstAiderPhone: toE164(firstAiderPhone) };
  // A date that is not a date is dropped, not trusted: the numbers are still good.
  return typeof savedAt === "string" && !Number.isNaN(Date.parse(savedAt)) ? { ...numbers, savedAt } : numbers;
}

/** Whether two sets of contacts hold the same numbers (both absent counts as the same). The save date is not a number: it never counts. */
export function sameContacts(a: SiteContacts | undefined, b: SiteContacts | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.supervisorPhone === b.supervisorPhone && a.firstAiderPhone === b.firstAiderPhone;
}

/** A stored value is a pin only when it has a site id and a crew id that is a string or null (the store's rule). */
export function toSitePin(value: unknown): SitePin | null {
  if (typeof value !== "object" || value === null) return null;
  const { siteId, crewId, contacts } = value as Record<string, unknown>;
  if (!isNonEmpty(siteId)) return null;
  if (crewId !== null && !isNonEmpty(crewId)) return null;
  const known = toSiteContacts(contacts);
  return known === undefined ? { siteId, crewId } : { siteId, crewId, contacts: known };
}

/**
 * What else the phone holds, as two flags: a profile is saved (Today then loads the on-device risk code to work out the personal
 * level, and nothing of it otherwise), and a push registration exists (Today then does not offer "Turn on warnings"). Read here so
 * that Today need not import the profile store to ask: the store would pull zustand's persist middleware and `revoke` into the
 * first load of the page for a phone that has neither (F2 W1, the route script budget). A flag says only that a value is there;
 * the store validates the value itself when something loads it.
 */
export interface DeviceFlags {
  readonly hasProfile: boolean;
  readonly hasPush: boolean;
}

const NO_FLAGS: DeviceFlags = { hasProfile: false, hasPush: false };

// undefined: the store has not published, read storage. null: published "no pin".
let published: SitePin | null | undefined;
let publishedFlags: DeviceFlags | undefined;
const listeners = new Set<() => void>();
let parsed: { raw: string | null; pin: SitePin | null; flags: DeviceFlags } = { raw: null, pin: null, flags: NO_FLAGS };

function emit(): void {
  for (const listener of listeners) listener();
}

/** Called by the profile store after it changes the pin. */
export function publishSitePin(pin: SitePin | null): void {
  published = pin;
  emit();
}

/** Called by the profile store after it changes the profile or the push registration. */
export function publishDeviceFlags(flags: DeviceFlags): void {
  if (publishedFlags?.hasProfile === flags.hasProfile && publishedFlags.hasPush === flags.hasPush) return;
  publishedFlags = flags;
  emit();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStorage(): { pin: SitePin | null; flags: DeviceFlags } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PROFILE_STORAGE_KEY);
  } catch {
    return { pin: null, flags: NO_FLAGS };
  }
  // The same object for the same text: useSyncExternalStore compares snapshots by identity.
  if (raw === parsed.raw) return parsed;
  let pin: SitePin | null = null;
  let flags = NO_FLAGS;
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    const state = isRecord(value) ? value["state"] : null;
    if (isRecord(state)) {
      pin = toSitePin(state["site"]);
      flags = { hasProfile: isRecord(state["profile"]), hasPush: isRecord(state["push"]) };
    }
  } catch {
    pin = null;
    flags = NO_FLAGS;
  }
  parsed = { raw, pin, flags };
  return parsed;
}

/** The pin now: what the store last published, else what storage holds, else null. */
export function readSitePin(): SitePin | null {
  return published !== undefined ? published : readStorage().pin;
}

/** The flags now: what the store last published, else what storage holds. A stable object while nothing changed. */
export function readDeviceFlags(): DeviceFlags {
  return publishedFlags !== undefined ? publishedFlags : readStorage().flags;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== PROFILE_STORAGE_KEY) return;
    // Another tab changed (or removed) the stored data: what this tab published is out of date.
    published = undefined;
    publishedFlags = undefined;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The pin, for a component that only shows it. `null` on the server and until the phone says otherwise. */
export function useSitePin(): SitePin | null {
  return useSyncExternalStore(subscribe, readSitePin, () => null);
}

/** Whether a profile is saved on this phone. False on the server and until the phone says otherwise. */
export function useHasProfile(): boolean {
  return useSyncExternalStore(subscribe, () => readDeviceFlags().hasProfile, () => false);
}

/** Whether this phone holds a push registration. False on the server and until the phone says otherwise. */
export function useHasPush(): boolean {
  return useSyncExternalStore(subscribe, () => readDeviceFlags().hasPush, () => false);
}

/**
 * The pin that choosing `siteId` and `crewId` makes: the stored contacts survive choosing the same site again without new
 * ones, and are dropped when the site changes (another site's supervisor number must never be offered for this one).
 */
export function nextSitePin(current: SitePin | null, siteId: string, crewId: string | null, contacts?: SiteContacts): SitePin {
  const kept = contacts ?? (current?.siteId === siteId ? current.contacts : undefined);
  return kept === undefined ? { siteId, crewId } : { siteId, crewId, contacts: kept };
}

/** For tests: forgets what the store published and what was parsed. */
export function resetSitePinForTests(): void {
  published = undefined;
  publishedFlags = undefined;
  parsed = { raw: null, pin: null, flags: NO_FLAGS };
}

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
  const { supervisorPhone, firstAiderPhone } = value as Record<string, unknown>;
  const ok = (field: unknown) => field === null || typeof field === "string";
  if (!ok(supervisorPhone) || !ok(firstAiderPhone)) return undefined;
  return { supervisorPhone: toE164(supervisorPhone), firstAiderPhone: toE164(firstAiderPhone) };
}

/** Whether two sets of contacts hold the same numbers (both absent counts as the same). */
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

// undefined: the store has not published, read storage. null: published "no pin".
let published: SitePin | null | undefined;
const listeners = new Set<() => void>();
let parsed: { raw: string | null; pin: SitePin | null } = { raw: null, pin: null };

function emit(): void {
  for (const listener of listeners) listener();
}

/** Called by the profile store after it changes the pin. */
export function publishSitePin(pin: SitePin | null): void {
  published = pin;
  emit();
}

function readStorage(): SitePin | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PROFILE_STORAGE_KEY);
  } catch {
    return null;
  }
  // The same object for the same text: useSyncExternalStore compares snapshots by identity.
  if (raw === parsed.raw) return parsed.pin;
  let pin: SitePin | null = null;
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    const state = typeof value === "object" && value !== null ? (value as Record<string, unknown>)["state"] : null;
    pin = typeof state === "object" && state !== null ? toSitePin((state as Record<string, unknown>)["site"]) : null;
  } catch {
    pin = null;
  }
  parsed = { raw, pin };
  return pin;
}

/** The pin now: what the store last published, else what storage holds, else null. */
export function readSitePin(): SitePin | null {
  return published !== undefined ? published : readStorage();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== PROFILE_STORAGE_KEY) return;
    // Another tab changed (or removed) the stored data: what this tab published is out of date.
    published = undefined;
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

/** For tests: forgets what the store published and what was parsed. */
export function resetSitePinForTests(): void {
  published = undefined;
  parsed = { raw: null, pin: null };
}

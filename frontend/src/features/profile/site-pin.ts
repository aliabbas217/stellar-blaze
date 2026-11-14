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

/** Which site, and optionally which crew, this phone is pinned to. Chosen on the phone; the API never hears of it. */
export interface SitePin {
  readonly siteId: string;
  readonly crewId: string | null;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** A stored value is a pin only when it has a site id and a crew id that is a string or null (the store's rule). */
export function toSitePin(value: unknown): SitePin | null {
  if (typeof value !== "object" || value === null) return null;
  const { siteId, crewId } = value as Record<string, unknown>;
  if (!isNonEmpty(siteId)) return null;
  if (crewId !== null && !isNonEmpty(crewId)) return null;
  return { siteId, crewId };
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

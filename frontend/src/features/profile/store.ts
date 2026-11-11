import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/*
 * The on-device store (ADR 0004, plan section 8.8): what the app remembers on this phone and never sends to the
 * server. Persisted to localStorage under `sb-profile-v1`.
 *
 * Only the push slice exists so far. Task 8 adds the worker profile next to it: widen `profile` to
 * `Profile | null`, add `save` and `revoke`, add `profile` to `partialize` and to `merge`'s validation. Until then
 * `profile` is always null, so nothing here can hold a workload class, a start date or a clothing option.
 *
 * Rendering from this store is hydration-safe: zustand 5 gives React the pre-hydration state as the server snapshot.
 */

export const PROFILE_STORAGE_KEY = "sb-profile-v1";

/** The API's registration of this browser's push subscription. It carries the site, never anything about the worker. */
export interface PushRegistration {
  /** The id `POST /api/v1/push/subscriptions` returned, needed to delete the registration. */
  readonly serverId: string;
  /** The browser subscription's endpoint when it was registered: a different one on app open means "register again". */
  readonly endpoint: string;
  readonly siteId: string;
}

export interface ProfileState {
  /** Task 8 widens this. Always null until then. */
  readonly profile: null;
  readonly push: PushRegistration | null;
  readonly setPush: (push: PushRegistration | null) => void;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** A stored push slice that has the shape we wrote; anything else (an older shape, a hand edit) is dropped. */
function toPushRegistration(value: unknown): PushRegistration | null {
  if (typeof value !== "object" || value === null) return null;
  const { serverId, endpoint, siteId } = value as Record<string, unknown>;
  if (!isNonEmptyString(serverId) || !isNonEmptyString(endpoint) || !isNonEmptyString(siteId)) return null;
  return { serverId, endpoint, siteId };
}

// Every access is guarded: localStorage throws when it is blocked (a private window, site data disabled), when it is
// full, and does not exist on the server. In each case the store keeps working in memory and nothing is persisted.
const guardedLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // In-memory only from here on; see above.
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // See above.
    }
  },
};

export const useProfile = create<ProfileState>()(
  persist(
    (set) => ({
      profile: null,
      push: null,
      setPush: (push) => {
        set({ push });
      },
    }),
    {
      name: PROFILE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => guardedLocalStorage),
      partialize: (state) => ({ push: state.push }),
      // Corrupt JSON never reaches here (zustand drops it and keeps the initial state); a parseable value of the wrong
      // shape is validated field by field instead of being trusted.
      merge: (persisted, current) => ({
        ...current,
        push: toPushRegistration((persisted as { push?: unknown } | null | undefined)?.push),
      }),
    },
  ),
);

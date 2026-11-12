import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { browserEffects, type ProfileEffects } from "@/features/profile/effects";
import { isNonEmptyString, toProfile, type Profile } from "@/features/profile/profile-shape";
import { readPendingDeletes, rememberPendingDelete, retryPendingDeletes } from "@/features/push/pending-delete";

/*
 * The on-device store (ADR 0004, plan section 8.8): what the app remembers on this phone and never sends to the
 * server. Persisted to localStorage under `sb-profile-v1`:
 *  - `profile`: the worker's profile (workload class, heat-work start date, clothing option, site and crew, and the
 *    consent it was given under);
 *  - `push`: the API's registration of this browser's alert subscription (Task 7).
 *
 * `revoke()` takes all of it back. Rendering from this store is hydration-safe: zustand 5 gives React the
 * pre-hydration state as the server snapshot.
 *
 * This file must stay free of zod: the Alerts route imports it, and zod would add about 15 KB gzip to a route that has
 * 9 KB left of its 170 KB budget. What is read back from storage goes through `toProfile` (profile-shape.ts) instead.
 */

export const PROFILE_STORAGE_KEY = "sb-profile-v1";

export type { ProfileEffects };

/** The API's registration of this browser's push subscription. It carries the site, never anything about the worker. */
export interface PushRegistration {
  /** The id `POST /api/v1/push/subscriptions` returned, needed to delete the registration. */
  readonly serverId: string;
  /** The browser subscription's endpoint when it was registered: a different one on app open means "register again". */
  readonly endpoint: string;
  readonly siteId: string;
}

/** A step of taking the data back that did not finish. */
export type RevokeStep =
  /** The stored data could not be removed from localStorage. */
  | "storage"
  /** The browser's push subscription could not be dropped (or the step did not finish in time): alerts may still arrive. */
  | "alerts"
  /** The cached API responses and pages, or Serwist's record of them, could not be removed. */
  | "cache";

export interface RevokeOutcome {
  /** The steps that did not finish; empty when each one did. The profile is cleared in memory either way. */
  readonly failed: readonly RevokeStep[];
  /**
   * True while the API has not confirmed deleting a push registration (ruling R32): its id is kept under
   * `sb-push-pending-delete-v1` and is retried on the next revoke, when Alerts opens and when push state is reconciled.
   */
  readonly pending: boolean;
}

/** Whether revoking finished everything. Anything else must never be shown to the worker as "removed". */
export function isRevokeComplete(outcome: RevokeOutcome): boolean {
  return outcome.failed.length === 0 && !outcome.pending;
}

export interface ProfileState {
  readonly profile: Profile | null;
  readonly push: PushRegistration | null;
  /**
   * Counts the times the worker's data was taken back on this phone, by `revoke()` here or by another tab (see below).
   * Not persisted. A flow that began before a revoke and finishes after it compares the count it read at the start:
   * when it moved, the flow must not write its result back (usePush does this before it stores a registration).
   */
  readonly revokeEpoch: number;
  readonly setPush: (push: PushRegistration | null) => void;
  /**
   * Keeps the worker's profile (already validated by the form). When the site differs from the stored profile's, the
   * cached API responses of the old site are cleared too.
   */
  readonly save: (profile: Profile) => void;
  /**
   * Takes the worker's data back: clears the profile and the push registration (memory and localStorage) first, then,
   * best effort and each with a time limit, drops the browser's subscription, deletes the API's registration, clears the
   * caches and empties Serwist's expiration record. Never rejects, and never reports more than it did: what did not
   * finish is in the outcome (`isRevokeComplete`). A second call while one runs joins it.
   */
  readonly revoke: () => Promise<RevokeOutcome>;
}

export interface ProfileStoreOptions {
  /** Replaces the browser-facing steps of revoke and of a change of site; a test passes fakes. */
  readonly effects?: Partial<ProfileEffects>;
}

/** How long revoke waits for each browser or network step before it reports the step as failed and moves on. */
export const REVOKE_STEP_TIMEOUT_MS = 10_000;

/** Runs `run` and settles with it; a synchronous throw becomes a rejection, and a step that never settles rejects after `ms`. */
function within<T>(run: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`The step did not finish within ${String(ms)} ms.`));
    }, ms);
    new Promise<T>((started) => {
      started(run());
    })
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer);
      });
  });
}

/** Clears the caches and Serwist's expiration record: both are attempted, and a failure of either is thrown. */
async function clearDeviceApiData(effects: ProfileEffects): Promise<void> {
  const results = await Promise.allSettled([
    new Promise((started) => {
      started(effects.clearCaches());
    }),
    new Promise((started) => {
      started(effects.clearCacheMetadata());
    }),
  ]);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed !== undefined) throw failed.reason;
}

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
      // See above. `revoke` reads the key back, so a removal that did not happen is reported there.
    }
  },
};

/** The store, with its browser-facing steps replaceable. The app uses `useProfile`; tests build their own. */
export function createProfileStore(options: ProfileStoreOptions = {}) {
  const effects: ProfileEffects = { ...browserEffects, ...options.effects };
  let revoking: Promise<RevokeOutcome> | null = null;

  const store = create<ProfileState>()(
    persist(
      (set, get, api) => ({
        profile: null,
        push: null,
        revokeEpoch: 0,
        setPush: (push) => {
          set({ push });
        },
        save: (profile) => {
          const previous = get().profile;
          set({ profile });
          // A different site: what the phone cached for the old one (forecasts, page URLs, and Serwist's record of
          // them) is not this worker's any more. Not on the first save: nothing was stored, and the policy the form
          // just used should stay cached. A failure is logged, not thrown: the profile is saved either way.
          if (previous !== null && previous.siteId !== profile.siteId) {
            clearDeviceApiData(effects).catch((error: unknown) => {
              console.error("Could not clear the cached API responses after the site changed.", error);
            });
          }
        },
        revoke: () => {
          if (revoking !== null) return revoking;

          // The registration's id is written down first, under its own key, because everything after this clears the
          // push slice that held it: a DELETE the API never confirms must still be owed after the page is gone.
          const serverId = get().push?.serverId ?? null;
          if (serverId !== null) rememberPendingDelete(serverId);

          // Local data next, before anything that waits on a browser API or the network: the worker's data is gone
          // from this phone whatever happens after.
          set({ profile: null, push: null, revokeEpoch: get().revokeEpoch + 1 });
          api.persist.clearStorage();
          // The guarded storage swallows a failed removal; reading the key back is how it is noticed.
          const stored = guardedLocalStorage.getItem(PROFILE_STORAGE_KEY) !== null;

          // The browser's subscription, then every registration still owed to the API (this one, and any an earlier
          // revoke could not delete). A failure of the first does not skip the second.
          const alerts = async () => {
            let dropped = true;
            let reason: unknown;
            try {
              await effects.unsubscribe();
            } catch (error) {
              dropped = false;
              reason = error;
            }
            await retryPendingDeletes(effects.deleteRegistration);
            if (!dropped) throw reason instanceof Error ? reason : new Error("The browser's push subscription was not dropped.");
          };

          const started = Promise.allSettled([
            within(alerts, REVOKE_STEP_TIMEOUT_MS),
            within(() => clearDeviceApiData(effects), REVOKE_STEP_TIMEOUT_MS),
          ]).then(([alertsStep, cacheStep]): RevokeOutcome => {
            const failed: RevokeStep[] = [];
            if (stored) failed.push("storage");
            if (alertsStep.status === "rejected") failed.push("alerts");
            if (cacheStep.status === "rejected") failed.push("cache");
            // Read when everything has settled: an id is outstanding if the API has not confirmed it, however that came about.
            return { failed, pending: readPendingDeletes().length > 0 };
          });
          revoking = started.finally(() => {
            revoking = null;
          });
          return revoking;
        },
      }),
      {
        name: PROFILE_STORAGE_KEY,
        // Not bumped for the profile: a state saved by Task 7 has no `profile` key, which reads as no profile.
        version: 1,
        storage: createJSONStorage(() => guardedLocalStorage),
        partialize: (state) => ({ profile: state.profile, push: state.push }),
        // Corrupt JSON never reaches here (zustand drops it and keeps the initial state); a parseable value of the wrong
        // shape is validated field by field instead of being trusted.
        merge: (persisted, current) => {
          const stored = persisted as { profile?: unknown; push?: unknown } | null | undefined;
          return { ...current, profile: toProfile(stored?.profile), push: toPushRegistration(stored?.push) };
        },
      },
    ),
  );

  // Another tab of the app changed the stored data (ruling R34). Without this, a tab that was open during a revoke in
  // another keeps the revoked data in memory, and its next write (a push registration, a saved profile) puts the data
  // back into localStorage. So the change is read in at once; and when it removed what this tab held, that counts as a
  // revoke here too, so that a flow still running in this tab can tell. `rehydrate` does not write what it reads.
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key !== null && event.key !== PROFILE_STORAGE_KEY) return;
      const before = store.getState();
      void Promise.resolve(store.persist.rehydrate()).then(() => {
        const after = store.getState();
        const held = before.profile !== null || before.push !== null;
        if (held && after.profile === null && after.push === null) store.setState({ revokeEpoch: after.revokeEpoch + 1 });
      });
    });
  }

  return store;
}

export const useProfile = createProfileStore();

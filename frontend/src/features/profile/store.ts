import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { browserEffects, type ProfileEffects } from "@/features/profile/effects";
import { isNonEmptyString, toProfile, type Profile } from "@/features/profile/profile-shape";
import { PROFILE_STORAGE_KEY, publishSitePin, toSitePin, type SitePin } from "@/features/profile/site-pin";
import {
  beginRevokeActivity,
  clearRevokeIncomplete,
  endRevokeActivity,
  markRevokeIncomplete,
  readRevokeIncomplete,
  type RevokeStep,
} from "@/features/profile/revoke-marker";
import {
  hasUnpersistedPendingDeletes,
  readPendingDeletes,
  rememberPendingDelete,
  retryPendingDeletes,
} from "@/features/push/pending-delete";

/*
 * The on-device store (ADR 0004, plan section 8.8): what the app remembers on this phone and never sends to the
 * server. Persisted to localStorage under `sb-profile-v1`:
 *  - `profile`: the worker's profile (workload class, heat-work start date, clothing option, site and crew, and the
 *    consent it was given under);
 *  - `push`: the API's registration of this browser's alert subscription (Task 7);
 *  - `site`: the site (and optionally the crew) this phone is pinned to (F2 Task 3, `useDeviceSite`).
 *
 * `revoke()` takes all of it back. Rendering from this store is hydration-safe: zustand 5 gives React the
 * pre-hydration state as the server snapshot.
 *
 * This file must stay free of zod: the Alerts route imports it, and zod would add about 15 KB gzip to a route that has
 * 9 KB left of its 170 KB budget. What is read back from storage goes through `toProfile` (profile-shape.ts) instead.
 */

export { PROFILE_STORAGE_KEY };

export type { ProfileEffects, RevokeStep };

/** The API's registration of this browser's push subscription. It carries the site, never anything about the worker. */
export interface PushRegistration {
  /** The id `POST /api/v1/push/subscriptions` returned, needed to delete the registration. */
  readonly serverId: string;
  /** The browser subscription's endpoint when it was registered: a different one on app open means "register again". */
  readonly endpoint: string;
  readonly siteId: string;
}

/**
 * Which site, and optionally which crew, this phone is pinned to. Chosen on the phone; the API never hears of it. Defined in
 * site-pin.ts (a module with no store in it, which the worker header reads); the store publishes every change there.
 */
export type DeviceSite = SitePin;

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
  /** The site pin (C7): taken back by `revoke()` with everything else, so a worker who removes their data is not left pinned to a crew. */
  readonly site: DeviceSite | null;
  /**
   * Counts the times the worker's data was taken back on this phone, by `revoke()` here or by another tab (see below).
   * Not persisted. A flow that began before a revoke and finishes after it compares the count it read at the start:
   * when it moved, the flow must not write its result back (usePush does this before it stores a registration).
   */
  readonly revokeEpoch: number;
  readonly setPush: (push: PushRegistration | null) => void;
  /** Pins the phone to a site and an optional crew. */
  readonly chooseSite: (site: DeviceSite) => void;
  /** Drops the pin only; nothing else is touched. */
  readonly clearSite: () => void;
  /**
   * Keeps the worker's profile (already validated by the form). When the site differs from the stored profile's, the
   * cached API responses of the old site are cleared too.
   */
  readonly save: (profile: Profile) => void;
  /**
   * Takes the worker's data back: writes the "data may remain" marker and the registration id first, then clears the
   * profile and the push registration (memory and localStorage), then, best effort and each with a time limit, drops the
   * browser's subscription, deletes the API's registration, clears the caches and the expiration record and checks that
   * they stayed cleared. Never rejects, and never reports more than it did: what did not finish is in the outcome
   * (`isRevokeComplete`) and in the marker, which is removed only when everything did. A second call while one runs joins it.
   */
  readonly revoke: () => Promise<RevokeOutcome>;
  /**
   * Finishes what an earlier revoke did not (ruling R36), for Alerts opening and the app's push reconcile: the caches and
   * the expiration record again, and the registrations owed to the API. It never touches the profile, the push state or
   * the browser's subscription, because the worker may have set up again since. Resolves the outcome of what it tried, or
   * null when there was nothing to tell (nothing to do, an owed registration retried quietly, or a revoke began meanwhile).
   * A call while a revoke runs returns that revoke's outcome; a revoke that starts while a resume runs supersedes it (the
   * resume finishes, leaves the marker alone and resolves null); two resumes do not overlap.
   */
  readonly resume: () => Promise<RevokeOutcome | null>;
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
async function clearBoth(effects: ProfileEffects): Promise<void> {
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

/**
 * Clears the caches and the expiration record, then looks: a response the service worker was still fetching when the
 * clearing ran is written after it (a NetworkFirst answer arriving late), and brings a cache and a row back (ruling R36).
 * If anything is there, or the look cannot be made, the whole clearing is done once more; a second failure is thrown.
 *
 * KNOWN LIMIT (ruling R38): the look is made once, straight after the clearing, and there is no settling delay. A response
 * that reaches Cache Storage later than that re-creates its cache, and "done" has already been said. It is accepted: a delay
 * would hold the worker's screen on "please wait" for a guess, and the worker is still on the page, which the service
 * worker caches again by design (so no check could ever promise an empty Cache Storage while the app is open). What is
 * cached is the same for everyone at a site (ADR 0004) and expires after 48 hours.
 */
async function clearDeviceData(effects: ProfileEffects): Promise<void> {
  let reason: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await clearBoth(effects);
      const remains = await new Promise<boolean>((started) => {
        started(effects.deviceDataRemains());
      });
      if (!remains) return;
      reason = new Error("Cached data was written again while it was being cleared.");
    } catch (error) {
      reason = error;
    }
  }
  throw reason instanceof Error ? reason : new Error("Clearing the cached data failed.");
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
  let resuming: Promise<RevokeOutcome | null> | null = null;
  // Counts the revokes that have started. A resume remembers the count it began under: if it has moved when the resume
  // ends, a revoke began meanwhile, owns the marker, and the resume must not write or clear it (ruling R36).
  let generation = 0;

  const store = create<ProfileState>()(
    persist(
      (set, get, api) => ({
        profile: null,
        push: null,
        site: null,
        revokeEpoch: 0,
        setPush: (push) => {
          set({ push });
        },
        chooseSite: (site) => {
          set({ site });
          // After the write (persist stores synchronously inside `set`): the worker header reads the pin without this store.
          publishSitePin(get().site);
        },
        clearSite: () => {
          set({ site: null });
          publishSitePin(null);
        },
        save: (profile) => {
          const previous = get().profile;
          set({ profile });
          // A different site: what the phone cached for the old one (forecasts, page URLs, and Serwist's record of
          // them) is not this worker's any more. Not on the first save: nothing was stored, and the policy the form
          // just used should stay cached. A failure is logged, not thrown: the profile is saved either way.
          if (previous !== null && previous.siteId !== profile.siteId) {
            clearDeviceData(effects).catch((error: unknown) => {
              console.error("Could not clear the cached API responses after the site changed.", error);
            });
          }
        },
        revoke: () => {
          if (revoking !== null) return revoking;

          // Written down first, before anything is cleared or waited for: that a revoke began and nothing is confirmed
          // yet (the marker), and the registration's id, because everything after this clears the push slice that held
          // it. A page that dies in the middle still leaves both. The id's write is read back; if it did not take, the
          // id is kept in memory and retried below, and reported if it is still owed at the end.
          const serverId = get().push?.serverId ?? null;
          generation += 1;
          // The screen is told a removal is running before the marker exists: the marker names every step as unfinished,
          // and a screen that read it without knowing would announce a failure that has not happened (NB1).
          beginRevokeActivity();
          markRevokeIncomplete(["storage", "alerts", "cache"]);
          if (serverId !== null) rememberPendingDelete(serverId);

          // Local data next, before anything that waits on a browser API or the network: the worker's data is gone
          // from this phone whatever happens after.
          set({ profile: null, push: null, site: null, revokeEpoch: get().revokeEpoch + 1 });
          api.persist.clearStorage();
          publishSitePin(null);
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
            within(() => clearDeviceData(effects), REVOKE_STEP_TIMEOUT_MS),
          ]).then(([alertsStep, cacheStep]): RevokeOutcome => {
            const failed: RevokeStep[] = [];
            // An owed id that exists only in memory is lost with this page: the write of it (a "storage" step) failed.
            if (stored || hasUnpersistedPendingDeletes()) failed.push("storage");
            if (alertsStep.status === "rejected") failed.push("alerts");
            if (cacheStep.status === "rejected") failed.push("cache");
            // Read when everything has settled: an id is outstanding if the API has not confirmed it, however that came about.
            const outcome: RevokeOutcome = { failed, pending: readPendingDeletes().length > 0 };
            // The marker goes only when every step finished; otherwise it says which did not, across reloads.
            if (isRevokeComplete(outcome)) clearRevokeIncomplete();
            else markRevokeIncomplete(failed);
            return outcome;
          });
          // Over only after the marker has its last word (cleared, or naming what failed).
          revoking = started.finally(() => {
            revoking = null;
            endRevokeActivity();
          });
          return revoking;
        },
        resume: () => {
          if (revoking !== null) return revoking;
          if (resuming !== null) return resuming;

          const marker = readRevokeIncomplete();
          if (marker === null && readPendingDeletes().length === 0) return Promise.resolve(null);

          // A revoke and a resume can overlap in one direction only: a revoke does not wait for a resume (the worker's tap
          // is not held up), it supersedes it. The resume then finishes what it was doing, and leaves the marker alone.
          const mine = generation;
          // Visible to the screen only when there is an unfinished removal to report on; an owed registration alone is a quiet retry.
          if (marker !== null) beginRevokeActivity();

          const run = async (): Promise<RevokeOutcome> => {
            // Only what is idempotent and owed: the caches, if that step was unfinished, and the API's registrations.
            const redo = marker?.steps.includes("cache") === true;
            const [cacheStep] = await Promise.allSettled([
              redo ? within(() => clearDeviceData(effects), REVOKE_STEP_TIMEOUT_MS) : Promise.resolve(),
              within(() => retryPendingDeletes(effects.deleteRegistration), REVOKE_STEP_TIMEOUT_MS),
            ]);
            const failed: RevokeStep[] = (marker?.steps ?? []).filter((step) => step !== "cache" || cacheStep.status === "rejected");
            if (hasUnpersistedPendingDeletes() && !failed.includes("storage")) failed.unshift("storage");
            const outcome: RevokeOutcome = { failed, pending: readPendingDeletes().length > 0 };
            // Only if no revoke began meanwhile: the marker is then that revoke's, and what this resume read is out of date.
            if (marker !== null && generation === mine) {
              if (isRevokeComplete(outcome)) clearRevokeIncomplete();
              else markRevokeIncomplete(failed);
            }
            return outcome;
          };
          // With no unfinished revoke behind it (an owed registration alone) it is a quiet retry: nothing to tell the worker.
          // A superseded resume tells the page nothing either: the revoke that superseded it has its own outcome.
          resuming = run()
            .then((outcome) => (marker === null || generation !== mine ? null : outcome))
            .finally(() => {
              resuming = null;
              if (marker !== null) endRevokeActivity();
            });
          return resuming;
        },
      }),
      {
        name: PROFILE_STORAGE_KEY,
        // Not bumped for the profile: a state saved by Task 7 has no `profile` key, which reads as no profile.
        version: 1,
        storage: createJSONStorage(() => guardedLocalStorage),
        partialize: (state) => ({ profile: state.profile, push: state.push, site: state.site }),
        // Corrupt JSON never reaches here (zustand drops it and keeps the initial state); a parseable value of the wrong
        // shape is validated field by field instead of being trusted.
        merge: (persisted, current) => {
          const stored = persisted as { profile?: unknown; push?: unknown; site?: unknown } | null | undefined;
          const profile = toProfile(stored?.profile);
          const push = toPushRegistration(stored?.push);
          const site = toSitePin(stored?.site);
          // What was read removed everything this tab held: another tab revoked (see the listener below). That counts as
          // a revoke here, so the epoch moves; it moves here, in the merge, because setting it afterwards would go
          // through persist and write the key back (ruling R37).
          const removed =
            (current.profile !== null || current.push !== null || current.site !== null) &&
            profile === null &&
            push === null &&
            site === null;
          return { ...current, profile, push, site, revokeEpoch: current.revokeEpoch + (removed ? 1 : 0) };
        },
      },
    ),
  );

  // Another tab of the app changed the stored data (ruling R34). Without this, a tab that was open during a revoke in
  // another keeps the revoked data in memory, and its next write (a push registration, a saved profile) puts the data
  // back into localStorage. So the change is read in at once (`rehydrate` does not write what it reads).
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key !== null && event.key !== PROFILE_STORAGE_KEY) return;
      void store.persist.rehydrate();
    });
  }

  return store;
}

export const useProfile = createProfileStore();

"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiProblem, type Problem } from "@/api/problem";
import { useProfile } from "@/features/profile/store";
import { deleteSubscription, postSubscription } from "@/features/push/api";
import { pushCapability, readPushEnv, type PushCapability } from "@/features/push/capability";
import { deleteRegistration, rememberPendingDelete, retryPendingDeletes } from "@/features/push/pending-delete";
import { subscribeToSiteAlerts, unsubscribe, type RegistrationLike, type SubscribeOutcome } from "@/features/push/subscribe";

/*
 * The Alerts screen's state machine: idle | requesting | subscribed | denied | error. It holds the browser's side
 * (permission, subscription) and the API's (the registration id), keeps the API's side in the on-device store so the
 * next app open can tell whether the browser's subscription is still the one the API knows, and registers again when
 * it is not.
 *
 * Nothing here throws to the caller: the Enable button must never break the screen (review focus 4).
 */

export type PushState = "idle" | "requesting" | "subscribed" | "denied" | "error";

/** Which action the last failure belongs to, so the screen can say "on" or "off". */
export type PushFailure = "enable" | "disable";

export interface PushConfig {
  /** From the server's runtime environment; null when the deployment has none (alerts cannot be turned on). */
  readonly vapidPublicKey: string | null;
  /** The site the alerts are for; null until the worker has one (Task 8's profile). */
  readonly siteId: string | null;
  readonly crewId?: string | null;
}

/** The browser, behind an interface so the state machine runs in jsdom with fakes. */
export interface PushPlatform {
  readonly capability: () => PushCapability;
  /** The notification permission as the browser reports it now. "default" where there is no Notification API. */
  readonly permission: () => NotificationPermission;
  /** Calls `onChange` when the worker changes the permission in the browser's settings; returns the unsubscribe. */
  readonly watchPermission: (onChange: () => void) => () => void;
  readonly requestPermission: () => Promise<NotificationPermission>;
  /** The registration of the app's service worker, once it is active. */
  readonly registration: () => Promise<RegistrationLike>;
}

export const browserPlatform: PushPlatform = {
  capability: () => pushCapability(readPushEnv()),
  permission: () => ("Notification" in window ? Notification.permission : "default"),
  watchPermission: (onChange) => {
    let status: PermissionStatus | undefined;
    let disposed = false;
    // The Permissions API reports a change made in the browser's settings while the page is open. Not every browser
    // accepts the "notifications" name (Safari rejects it): there the screen just re-reads on its next render.
    if ("permissions" in navigator) {
      navigator.permissions
        .query({ name: "notifications" })
        .then((result) => {
          if (disposed) return;
          status = result;
          result.addEventListener("change", onChange);
        })
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
      status?.removeEventListener("change", onChange);
    };
  },
  requestPermission: () => Notification.requestPermission(),
  registration: () => navigator.serviceWorker.ready,
};

export interface UsePush {
  readonly state: PushState;
  /** What the browser holds, present in every state where it holds one (the spike's debug view reads it). */
  readonly subscription: PushSubscriptionJSON | null;
  /** The API's refusal behind the last failure, when there was one: it carries the request id. */
  readonly problem: Problem | null;
  readonly failure: PushFailure | null;
  /** Asks permission, subscribes and registers. Call it from a tap: browsers require a user gesture. */
  readonly enable: () => Promise<void>;
  /** Unsubscribes in the browser and deletes the API's registration. */
  readonly disable: () => Promise<void>;
}

const SERVER_PERMISSION: NotificationPermission = "default";

/**
 * How long Enable and Turn off wait for the service worker. `navigator.serviceWorker.ready` never settles when no worker
 * registers (a browser that blocks them, a failed install), and a tap that waits forever leaves the button disabled
 * and the screen stuck on "please wait"; after this the tap ends in the error state and can be tried again.
 */
export const REGISTRATION_TIMEOUT_MS = 10_000;

function readyRegistration(platform: PushPlatform): Promise<RegistrationLike> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("The service worker did not become ready."));
    }, REGISTRATION_TIMEOUT_MS);
    void platform
      .registration()
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer);
      });
  });
}

/**
 * A browser subscription made while a revoke was running (the worker took their data back from another tab, or this
 * one, between the tap and the API's answer) must not outlive it: drop it, and delete the API's registration, or owe
 * the DELETE when the API cannot be reached. Best effort, and it never throws.
 */
async function undoAfterRevoke(registration: RegistrationLike, serverId: string | null): Promise<void> {
  if (serverId !== null) rememberPendingDelete(serverId);
  try {
    await (await registration.pushManager.getSubscription())?.unsubscribe();
  } catch {
    // The subscription stays; the next revoke, or the next app open, drops it.
  }
  await retryPendingDeletes();
}

export function usePush(config: PushConfig, platform: PushPlatform = browserPlatform): UsePush {
  const { vapidPublicKey, siteId } = config;
  const crewId = config.crewId ?? null;
  const setPush = useProfile((state) => state.setPush);
  // A permission the worker blocked, earlier or in the browser's settings while the page is open, is "denied" at once.
  const permission = useSyncExternalStore(platform.watchPermission, platform.permission, () => SERVER_PERMISSION);

  const [state, setState] = useState<PushState>("idle");
  const [subscription, setSubscription] = useState<PushSubscriptionJSON | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [failure, setFailure] = useState<PushFailure | null>(null);
  // A second tap while one is running joins it instead of starting another.
  const busy = useRef(false);

  /**
   * Subscribes in the browser and registers with the API. `epoch` is the store's revoke count when the flow began: when it
   * has moved by the time the API answers, the worker took their data back meanwhile (ruling R34), so nothing is stored,
   * what was made is undone, and null is returned.
   */
  const register = useCallback(
    async (registration: RegistrationLike, key: string, site: string, epoch: number): Promise<SubscribeOutcome | null> => {
      const previous = useProfile.getState().push;
      const outcome = await subscribeToSiteAlerts({ registration, vapidPublicKey: key, siteId: site, crewId, post: postSubscription });
      if (useProfile.getState().revokeEpoch !== epoch) {
        await undoAfterRevoke(registration, outcome.serverId);
        return null;
      }
      setSubscription(outcome.subscription);
      if (outcome.serverId !== null) {
        setPush({ serverId: outcome.serverId, endpoint: outcome.subscription.endpoint, siteId: site });
        // The new registration replaces the one stored before (another site, or the browser's endpoint changed): delete
        // the old one, or the API keeps pushing to an address this phone no longer uses. If the API does not confirm it,
        // the id is owed (pending-delete.ts) and retried on a later open; the API's own pruning of dead endpoints
        // (contract section 5) is what remains after that.
        if (previous !== null && previous.serverId !== outcome.serverId && !(await deleteRegistration(previous.serverId))) {
          rememberPendingDelete(previous.serverId);
        }
      }
      return outcome;
    },
    [crewId, setPush],
  );

  // App open: reconcile what the browser holds with what the API was told. The browser can rotate or drop a
  // subscription without telling the page (Safari never fires pushsubscriptionchange), so only this check notices.
  useEffect(() => {
    if (permission !== "granted" || platform.capability() !== "supported") return;

    const abort = new AbortController();
    // Read when the check begins: a revoke after this point means the worker took their data back, and what this check
    // finds is no longer theirs to act on (ruling R34).
    const epoch = useProfile.getState().revokeEpoch;
    // A function, so the check is read again after each await instead of being narrowed away.
    const stale = () => abort.signal.aborted || busy.current || useProfile.getState().revokeEpoch !== epoch;
    // What an earlier revoke did not finish (rulings R32, R36): the registrations the API has not confirmed deleting, and
    // the caches, asked again each time the app opens. It never touches the profile or the push state.
    void useProfile.getState().resume();
    void (async () => {
      try {
        const registration = await readyRegistration(platform);
        const existing = await registration.pushManager.getSubscription();
        // A tap on Enable that started meanwhile registers by itself; this check must not race it.
        if (stale()) return;

        const stored = useProfile.getState().push;
        if (existing === null) {
          // The browser dropped the subscription: the API's registration is dead weight. Delete it before forgetting
          // its id; when the API cannot be reached the id stays, and the next app open tries again.
          if (stored !== null && (await deleteRegistration(stored.serverId))) {
            // Unless a tap on Enable registered a new one while the delete was running.
            if (useProfile.getState().push?.serverId === stored.serverId) setPush(null);
          }
          return;
        }
        setSubscription({ ...existing.toJSON(), endpoint: existing.endpoint });

        if (stored !== null && stored.endpoint === existing.endpoint && (siteId === null || stored.siteId === siteId)) {
          setState("subscribed");
          return;
        }
        if (vapidPublicKey === null || siteId === null) return;

        const outcome = await register(registration, vapidPublicKey, siteId, epoch);
        // Null: a revoke overtook the registration and it was undone. The screen is idle, as the revoke left it.
        if (outcome === null || abort.signal.aborted) return;
        if (outcome.serverId === null) {
          setProblem(outcome.problem);
          setFailure("enable");
          setState("error");
        } else {
          setState("subscribed");
        }
      } catch {
        // Reconciling is a background check: when it fails the screen stays as it was (alerts off) and the worker can
        // still tap Enable, which reports its own failure. It must not turn a working screen into an error.
      }
    })();
    return () => {
      abort.abort();
    };
  }, [permission, platform, setPush, siteId, vapidPublicKey, register]);

  const enable = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setProblem(null);
    setFailure(null);
    try {
      if (vapidPublicKey === null || siteId === null) {
        setFailure("enable");
        setState("error");
        return;
      }
      setState("requesting");
      // The revoke count at the tap (ruling R34); read here, and the prompt below still comes first with no await before it.
      const epoch = useProfile.getState().revokeEpoch;
      // First, with no await before it: browsers (iOS above all) only show the permission prompt inside the tap.
      const answer = await platform.requestPermission();
      if (answer === "denied") {
        setState("denied");
        return;
      }
      if (answer !== "granted") {
        setState("idle");
        return;
      }
      // The worker took their data back while the prompt was open (another tab): that tap is not theirs any more.
      if (useProfile.getState().revokeEpoch !== epoch) {
        setState("idle");
        return;
      }
      const outcome = await register(await readyRegistration(platform), vapidPublicKey, siteId, epoch);
      if (outcome === null) {
        setSubscription(null);
        setState("idle");
        return;
      }
      if (outcome.serverId === null) {
        setProblem(outcome.problem);
        setFailure("enable");
        setState("error");
        return;
      }
      setState("subscribed");
    } catch {
      setFailure("enable");
      setState("error");
    } finally {
      busy.current = false;
    }
  }, [platform, register, siteId, vapidPublicKey]);

  const disable = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setProblem(null);
    setFailure(null);
    setState("requesting");
    try {
      const registration = await readyRegistration(platform);
      await unsubscribe({ registration, serverId: useProfile.getState().push?.serverId ?? null, remove: deleteSubscription });
      setPush(null);
      setSubscription(null);
      setState("idle");
    } catch (error) {
      // The stored registration is kept, so the next tap retries the DELETE.
      setFailure("disable");
      setState("error");
      if (error instanceof ApiProblem) setProblem(error.problem);
    } finally {
      busy.current = false;
    }
  }, [platform, setPush]);

  return {
    state: permission === "denied" && state !== "requesting" ? "denied" : state,
    subscription,
    problem,
    failure,
    enable,
    disable,
  };
}

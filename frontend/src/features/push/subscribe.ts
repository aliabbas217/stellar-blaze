import { ApiProblem, type Problem } from "@/api/problem";
import type { Result } from "@/api/result";
import type { components } from "@/api/schema";

/*
 * Registering this browser for site/crew alerts: ask the browser for a push subscription, then tell the API about it
 * (docs/contracts/web-push.md section 1). Written against narrow structural types of the browser's objects so the
 * flow runs in jsdom with a fake PushManager and the real ServiceWorkerRegistration still fits.
 *
 * Governance (ADR 0004): the body sent to the API is the subscription plus `site_id` and an optional `crew_id`, and
 * nothing else. It is built field by field below, never spread from the browser's object.
 */

/** The part of `PushSubscription` this flow uses. */
export interface SubscriptionLike {
  readonly endpoint: string;
  readonly toJSON: () => PushSubscriptionJSON;
  readonly unsubscribe: () => Promise<boolean>;
}

/** The part of `PushManager` this flow uses. */
export interface PushManagerLike {
  readonly subscribe: (options: PushSubscriptionOptionsInit) => Promise<SubscriptionLike>;
  readonly getSubscription: () => Promise<SubscriptionLike | null>;
}

/** What a `ServiceWorkerRegistration` must offer; the real one satisfies it. */
export interface RegistrationLike {
  readonly pushManager: PushManagerLike;
}

export type PushSubscriptionBody = components["schemas"]["PushSubscriptionCreate"];
export type PushSubscriptionCreated = components["schemas"]["PushSubscriptionCreated"];

export interface SubscribeDeps {
  readonly registration: RegistrationLike;
  /** The VAPID public key, base64url. */
  readonly vapidPublicKey: string;
  readonly siteId: string;
  readonly crewId: string | null;
  readonly post: (body: PushSubscriptionBody) => Promise<Result<PushSubscriptionCreated>>;
}

export interface SubscribeOutcome {
  /** What the browser produced. Present even when the server said no: the real-phone spike needs it. */
  readonly subscription: PushSubscriptionJSON & { readonly endpoint: string };
  /** The API's id for the registration; null when the registration failed. */
  readonly serverId: string | null;
  /** Why the registration failed; null when it did not. */
  readonly problem: Problem | null;
}

/** `applicationServerKey` as bytes. A base64url string is accepted by some browsers only; bytes by all. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const unpadded = base64Url.replace(/=+$/, "");
  const padded = unpadded.padEnd(unpadded.length + ((4 - (unpadded.length % 4)) % 4), "=");
  const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
}

/** The API body for a browser subscription. Throws when the browser's own object lacks what the API needs. */
function toBody(subscription: PushSubscriptionJSON, siteId: string, crewId: string | null): PushSubscriptionBody {
  const { endpoint, expirationTime, keys } = subscription;
  const p256dh = keys?.["p256dh"];
  const auth = keys?.["auth"];
  if (endpoint === undefined || p256dh === undefined || auth === undefined) {
    throw new Error("The browser returned an incomplete push subscription (endpoint or keys missing).");
  }
  return {
    subscription: { endpoint, expirationTime: expirationTime ?? null, keys: { p256dh, auth } },
    site_id: siteId,
    crew_id: crewId,
  };
}

/**
 * Asks the browser for a subscription with the VAPID key. A browser that already holds one made with another key
 * (the VAPID keys were regenerated, which the real-phone spike does) refuses with an InvalidStateError and keeps
 * refusing until that subscription is dropped: so drop it and ask once more. The dropped subscription's registration at
 * the API is deleted by the caller once the new one is registered (it has another id).
 */
async function subscribeToPushService(manager: PushManagerLike, vapidPublicKey: string): Promise<SubscriptionLike> {
  const options = { userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) };
  try {
    return await manager.subscribe(options);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error;
    await (await manager.getSubscription())?.unsubscribe();
    return manager.subscribe(options);
  }
}

async function subscribeOnce(deps: SubscribeDeps): Promise<SubscribeOutcome> {
  const subscription = await subscribeToPushService(deps.registration.pushManager, deps.vapidPublicKey);
  const fromBrowser = subscription.toJSON();
  const body = toBody(fromBrowser, deps.siteId, deps.crewId);
  // toBody has proven the endpoint is there; the type says so.
  const json = { ...fromBrowser, endpoint: body.subscription.endpoint };
  const result = await deps.post(body);
  return result.ok
    ? { subscription: json, serverId: result.data.id, problem: null }
    : { subscription: json, serverId: null, problem: result.problem };
}

// A second tap while the first is still asking the browser (permission sheet, push service round trip) must not
// start a second subscribe: it joins the first. Keyed by the manager, and by the arguments so that a call for
// another site is never answered with this one's result.
const inFlight = new WeakMap<PushManagerLike, { readonly key: string; readonly promise: Promise<SubscribeOutcome> }>();

/**
 * Subscribes this browser and registers the subscription for `siteId` (and `crewId`). The local subscription is
 * returned even when the server refuses (`problem` says why), so a phone that cannot reach the API still shows what
 * the browser produced. Rejects only when the browser itself fails (permission, push service, malformed key).
 */
export function subscribeToSiteAlerts(deps: SubscribeDeps): Promise<SubscribeOutcome> {
  const manager = deps.registration.pushManager;
  const key = JSON.stringify([deps.vapidPublicKey, deps.siteId, deps.crewId]);
  const running = inFlight.get(manager);
  if (running?.key === key) return running.promise;

  const promise: Promise<SubscribeOutcome> = subscribeOnce(deps).finally(() => {
    if (inFlight.get(manager)?.promise === promise) inFlight.delete(manager);
  });
  inFlight.set(manager, { key, promise });
  return promise;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export interface UnsubscribeDeps {
  readonly registration: RegistrationLike;
  /** The API's id for this browser's registration, when one is stored. */
  readonly serverId: string | null;
  readonly remove: (serverId: string) => Promise<Result<unknown>>;
}

/**
 * Stops alerts on this phone: unsubscribes in the browser and, when a server id is stored, asks the API to delete
 * the registration. Both are always attempted, so a failure of one never leaves the other undone. A failure is not
 * swallowed: whoever withdraws consent must not be told it worked while the server may still hold the subscription.
 */
export async function unsubscribe(deps: UnsubscribeDeps): Promise<void> {
  const failures: Error[] = [];

  try {
    const existing = await deps.registration.pushManager.getSubscription();
    await existing?.unsubscribe();
  } catch (error) {
    failures.push(asError(error));
  }

  if (deps.serverId !== null) {
    try {
      const result = await deps.remove(deps.serverId);
      if (!result.ok) failures.push(new ApiProblem(result.problem));
    } catch (error) {
      failures.push(asError(error));
    }
  }

  const [first] = failures;
  if (failures.length > 1) throw new AggregateError(failures, "Turning alerts off failed in the browser and on the server.");
  if (first !== undefined) throw first;
}

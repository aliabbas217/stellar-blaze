import { deleteSubscription } from "@/features/push/api";

/*
 * A push registration the API has not confirmed deleting (ruling R32).
 *
 * When a worker takes their data back, the on-device profile and push state are cleared first. If the DELETE of the API's
 * registration then fails or is not answered, the phone must not forget that it is owed: a retry that finds no id would
 * report "done" while the server still holds a subscription. So the registration's opaque id, and only that, is kept
 * under its own key until the API confirms the registration is gone. It is retried on the next revoke, when the Alerts
 * screen opens and when the app reconciles its push state (usePush).
 *
 * Governance (ADR 0004): the id is what the API returned for the subscription. It names no worker; the endpoint, the site
 * and the profile are not kept here, so a phone that has revoked holds nothing about the worker but this number.
 */

export const PENDING_DELETE_KEY = "sb-push-pending-delete-v1";

/**
 * More than this many outstanding ids means the API has been unreachable across that many separate revocations; the
 * oldest is let go, and the API's own pruning of dead endpoints (contract section 5) is what remains for it.
 */
export const MAX_PENDING_DELETES = 10;

// Every access is guarded, like the profile store's: localStorage throws when it is blocked or full.
function readRaw(): string | null {
  try {
    return localStorage.getItem(PENDING_DELETE_KEY);
  } catch {
    return null;
  }
}

function write(ids: readonly string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(PENDING_DELETE_KEY);
    else localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(ids));
  } catch {
    // Nothing more can be done on a phone that refuses storage; the id is lost with the page.
  }
}

/** The ids still owed to the API, oldest first. Anything in storage that is not a list of non-empty strings is ignored. */
export function readPendingDeletes(): readonly string[] {
  const raw = readRaw();
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id !== "");
  } catch {
    return [];
  }
}

export function rememberPendingDelete(serverId: string): void {
  const ids = readPendingDeletes();
  if (ids.includes(serverId)) return;
  write([...ids, serverId].slice(-MAX_PENDING_DELETES));
}

export function forgetPendingDelete(serverId: string): void {
  const ids = readPendingDeletes();
  if (ids.includes(serverId)) write(ids.filter((id) => id !== serverId));
}

/**
 * Asks the API to delete a registration. Resolves true only when the API no longer has it: it deleted it (2xx), or does
 * not know it (404, 410). Anything else is not an answer about the registration and resolves false so that the id is
 * kept: 408 and 429 are the network and the API's load talking, 5xx is the server failing, other 4xx are about the
 * request. A request that never arrives (offline) is false too.
 */
export async function deleteRegistration(serverId: string): Promise<boolean> {
  try {
    const result = await deleteSubscription(serverId);
    return result.ok || result.problem.status === 404 || result.problem.status === 410;
  } catch {
    return false;
  }
}

// One retry at a time: a caller that arrives while another runs waits for it and then looks again, so an id remembered in
// between (a revoke that starts while the Alerts screen's retry is under way) is never skipped, and a DELETE the first
// pass confirmed is not sent a second time. The API client has no request timeout, so a pass that never settles must not
// hold the line for ever: after PASS_TIMEOUT_MS the next one goes ahead (the stuck one is left to finish or not).
export const PASS_TIMEOUT_MS = 10_000;
let tail: Promise<void> = Promise.resolve();

function settledOrTimedOut(promise: Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, PASS_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}

async function pass(remove: (serverId: string) => Promise<boolean>): Promise<readonly string[]> {
  for (const id of readPendingDeletes()) {
    let gone = false;
    try {
      gone = await remove(id);
    } catch {
      // Not confirmed: the id stays.
    }
    if (gone) forgetPendingDelete(id);
  }
  return readPendingDeletes();
}

/**
 * Tries the DELETE of every outstanding id and forgets those the API confirmed. Resolves with the ids still owed, which
 * is empty when nothing is.
 */
export function retryPendingDeletes(remove: (serverId: string) => Promise<boolean> = deleteRegistration): Promise<readonly string[]> {
  const next = tail.then(() => pass(remove));
  tail = settledOrTimedOut(next);
  return next;
}

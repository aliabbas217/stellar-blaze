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
 * The write is checked by reading it back (a localStorage that is full, blocked, or accepts and drops the write must not
 * leave an id owed to no one). An id that could not be written down is kept in memory for the life of the page, is retried
 * with the rest, and is reported by `hasUnpersistedPendingDeletes` so that nobody says "done" over it (ruling R36).
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

/** Ids that could not be written to storage: owed all the same, for as long as this page lives. */
const unsaved = new Set<string>();

// Every access is guarded, like the profile store's: localStorage throws when it is blocked or full.
function readStored(): readonly string[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PENDING_DELETE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id !== "");
  } catch {
    return [];
  }
}

function write(ids: readonly string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(PENDING_DELETE_KEY);
    else localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(ids));
  } catch {
    // The caller reads the key back to learn whether it took.
  }
}

/** The ids still owed to the API, oldest first: the stored ones, then any that could only be kept in memory. */
export function readPendingDeletes(): readonly string[] {
  const stored = readStored();
  return [...stored, ...[...unsaved].filter((id) => !stored.includes(id))];
}

/** Whether an owed id could not be written to storage: it is lost if this page is, so it must not be called settled. */
export function hasUnpersistedPendingDeletes(): boolean {
  return unsaved.size > 0;
}

/**
 * Writes an id down as owed, and checks by reading the key back. Returns true when it is in storage; false when it could
 * only be kept in memory (it is still owed and still retried, but it will not survive the page).
 */
export function rememberPendingDelete(serverId: string): boolean {
  const stored = readStored();
  if (!stored.includes(serverId)) write([...stored, serverId].slice(-MAX_PENDING_DELETES));
  if (readStored().includes(serverId)) {
    unsaved.delete(serverId);
    return true;
  }
  unsaved.add(serverId);
  return false;
}

export function forgetPendingDelete(serverId: string): void {
  unsaved.delete(serverId);
  const stored = readStored();
  if (stored.includes(serverId)) write(stored.filter((id) => id !== serverId));
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

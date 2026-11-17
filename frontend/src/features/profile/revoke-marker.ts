/*
 * A durable "data may remain" marker (ruling R36).
 *
 * Taking a worker's data back is several steps (the stored profile, the browser's subscription, the caches and Serwist's
 * record of them, the API's registration). When one does not finish, the phone must keep saying so after a reload, and
 * must try again: otherwise "removed" is said once, in a screen that is gone, while data may remain. This is that note.
 * It is written before the first step starts, so a page that dies in the middle leaves it, and removed only when every
 * step has finished.
 *
 * Governance (ADR 0004): it holds no personal data, and no id of anything. The value is a format version, the time it was
 * written, and the NAMES of the steps that have not finished. It is read by the Alerts screen (through
 * `subscribeRevokeIncomplete`) and by the store's `resume()`, which finishes what it can.
 */

export const INCOMPLETE_KEY = "sb-revoke-incomplete-v1";

/** A step of taking the data back. */
export type RevokeStep =
  /** The stored data could not be removed from localStorage (or a registration id could not be written down). */
  | "storage"
  /** The browser's push subscription could not be dropped (or the step did not finish in time): alerts may still arrive. */
  | "alerts"
  /** The cached API responses and pages, or Serwist's record of them, could not be removed. */
  | "cache";

const STEPS: readonly RevokeStep[] = ["storage", "alerts", "cache"];

export interface IncompleteRevoke {
  /** When it was written: an ISO 8601 date and time. */
  readonly at: string;
  /** The steps that have not finished. Empty when only the API's confirmation of a registration is outstanding. */
  readonly steps: readonly RevokeStep[];
}

const VERSION = 1;

// Where storage refuses the write, the marker still lives for as long as this page does.
let unsaved: IncompleteRevoke | null = null;
const listeners = new Set<() => void>();
let snapshot: { raw: string | null; unsaved: IncompleteRevoke | null; value: IncompleteRevoke | null } = { raw: null, unsaved: null, value: null };

function readRaw(): string | null {
  try {
    return localStorage.getItem(INCOMPLETE_KEY);
  } catch {
    return null;
  }
}

function isStep(value: unknown): value is RevokeStep {
  return STEPS.some((step) => step === value);
}

function parse(raw: string): IncompleteRevoke | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { v, at, steps } = value as Record<string, unknown>;
    if (v !== VERSION || typeof at !== "string" || !Array.isArray(steps) || !steps.every(isStep)) return null;
    return { at, steps };
  } catch {
    return null;
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * The marker, or null when none is set. It returns the same object for as long as nothing changed, as
 * `useSyncExternalStore` requires.
 */
export function readRevokeIncomplete(): IncompleteRevoke | null {
  const raw = readRaw();
  if (snapshot.raw === raw && snapshot.unsaved === unsaved) return snapshot.value;
  const value = (raw === null ? null : parse(raw)) ?? unsaved;
  snapshot = { raw, unsaved, value };
  return value;
}

/**
 * Says that the data may remain, naming the steps that have not finished (none: only a registration is owed to the API).
 * The write is checked by reading it back; where it did not take, the marker is kept in memory for this page.
 */
export function markRevokeIncomplete(steps: readonly RevokeStep[]): void {
  const value: IncompleteRevoke = { at: new Date().toISOString(), steps: STEPS.filter((step) => steps.includes(step)) };
  const raw = JSON.stringify({ v: VERSION, at: value.at, steps: value.steps });
  try {
    localStorage.setItem(INCOMPLETE_KEY, raw);
  } catch {
    // Kept in memory below.
  }
  unsaved = readRaw() === raw ? null : value;
  notify();
}

/** Says that nothing remains: every step has finished. A removal that did not take leaves the marker, which errs on the side of saying so. */
export function clearRevokeIncomplete(): void {
  try {
    localStorage.removeItem(INCOMPLETE_KEY);
  } catch {
    // The marker stays; see above.
  }
  unsaved = null;
  notify();
}

// Whether a removal, or the finishing of one, is running on this page. In memory only: it says nothing that outlives the page.
// Counted, because a revoke and a resume can overlap.
let activity = 0;
const activityListeners = new Set<() => void>();

/** Says that a removal (or the finishing of one) has started on this page. Call `endRevokeActivity` when it has settled. */
export function beginRevokeActivity(): void {
  activity += 1;
  if (activity === 1) for (const listener of activityListeners) listener();
}

export function endRevokeActivity(): void {
  if (activity === 0) return;
  activity -= 1;
  if (activity === 0) for (const listener of activityListeners) listener();
}

/**
 * Whether a removal is running on this page. While it is, the marker is not the news: it was written when the removal
 * began, naming every step as unfinished, and reading it as "could not finish" would announce a failure that has not happened.
 */
export function readRevokeActive(): boolean {
  return activity > 0;
}

export function subscribeRevokeActive(onChange: () => void): () => void {
  activityListeners.add(onChange);
  return () => {
    activityListeners.delete(onChange);
  };
}

/** Calls `onChange` when the marker changes here, or in another tab of the app. Returns the unsubscribe. */
export function subscribeRevokeIncomplete(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === INCOMPLETE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

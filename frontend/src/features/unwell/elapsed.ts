/*
 * The unwell sheet's elapsed timer, as pure functions. The tap time lives in `sessionStorage` and nowhere else: it is never
 * sent, never put in localStorage, a cookie or IndexedDB, and ends with the browser tab (the test
 * `test_timer_state_never_leaves_the_device` pins it).
 */

/** The one storage key of the sheet. */
export const TAP_KEY = "sb-unwell-t0";

/** The ruler's length: ten minutes from the tap, a design choice (the only published figure nearby is "within 10 to 15 minutes"). */
export const RULER_MINUTES = 10;

/**
 * A stored tap older than this is a different episode, not this one: a reload or a trip back to Today keeps the timer, but a
 * timer that still counts from yesterday's tap would read as a long emergency that is not happening. The sheet also says
 * the clock time of the tap, so a kept timer is never anonymous.
 */
export const KEEP_TAP_MS = 30 * 60_000;

/** The slice of Storage this needs; a blocked or absent storage is `null` and the tap lives in memory only. */
export type TapStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * The time of the tap, in epoch milliseconds: the stored one when it is a recent past time, else `now`, which is stored.
 * A stored value that is not a number, is in the future (the clock moved), or is older than `KEEP_TAP_MS` is replaced.
 */
export function tapTime(now: number, storage: TapStorage | null): number {
  let stored: number | null = null;
  try {
    const raw = storage?.getItem(TAP_KEY) ?? null;
    const value = raw === null || !/^\d{1,16}$/.test(raw) ? NaN : Number(raw);
    if (Number.isFinite(value) && value <= now && now - value <= KEEP_TAP_MS) stored = value;
  } catch {
    // Blocked storage: this visit only.
  }
  if (stored !== null) return stored;
  try {
    storage?.setItem(TAP_KEY, String(now));
  } catch {
    // See above.
  }
  return now;
}

/** `m:ss` from a count of milliseconds (never negative); minutes keep growing past 59. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  return `${String(Math.floor(total / 60))}:${String(seconds).padStart(2, "0")}`;
}

/** How much of the ruler has passed, 0 to 1. */
export function rulerFraction(ms: number): number {
  return Math.min(1, Math.max(0, ms / (RULER_MINUTES * 60_000)));
}

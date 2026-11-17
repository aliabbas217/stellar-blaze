/*
 * The API's clock, as the web app follows it (ADR 0034 amendment: ONE source of "now" in replay mode). A forecast response
 * carries the API's own reading (`now`); the app keeps that reading together with the MONOTONIC time at which the response
 * arrived, and "now" is the reading plus the monotonic time elapsed since. So the clock ticks, it cannot step when the
 * device's clock is corrected or is simply wrong, and it is re-synced by every forecast response (the next one carries a
 * new reading). Nothing here knows a replay moment: with no reading there is no time (null), never an invented one.
 */

/** When each response arrived, on the monotonic clock (`performance.now()`), keyed by the parsed response object. */
const arrivals = new WeakMap<object, number>();

/**
 * Records that `response` has just arrived and returns it. Called where the response is parsed (the query function), so
 * the time it waited in a cache is never counted as time that has not passed.
 */
export function stampArrival<T extends object>(response: T, monotonicMs: number = performance.now()): T {
  arrivals.set(response, monotonicMs);
  return response;
}

/** The monotonic time at which `response` arrived, or undefined when it was not stamped. */
export function arrivalOf(response: object): number | undefined {
  return arrivals.get(response);
}

const MINUTE_MS = 60_000;

/**
 * The API's clock now, from one reading: `serverNowMs` (epoch milliseconds, the API's `now`) plus the monotonic time
 * elapsed since `arrivedAtMs`, to the minute (the finest time any screen shows, and a stable value for a memo). A reading
 * from the future of the monotonic clock (a sample that arrived after `monotonicNowMs` was read) counts as just arrived.
 */
export function serverNowAt(serverNowMs: number, arrivedAtMs: number, monotonicNowMs: number): Date {
  const elapsed = Math.max(0, monotonicNowMs - arrivedAtMs);
  return new Date(Math.floor((serverNowMs + elapsed) / MINUTE_MS) * MINUTE_MS);
}

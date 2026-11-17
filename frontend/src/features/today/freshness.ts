import type { components } from "@/api/schema";

/*
 * Whether a forecast covers the present: the worker's half of review focus 3 (a forecast from yesterday must never look
 * live). Whether it is fresh is `forecastFreshness` in lib/forecast/freshness.ts, shared with the supervisor's screens and
 * re-exported here for the worker's own code.
 */

export { STALE_AFTER_MS, forecastFreshness, freshness, type Freshness } from "@/lib/forecast/freshness";

type HourForecast = components["schemas"]["HourForecast"];

const HOUR_MS = 60 * 60 * 1000;

/**
 * The hour whose [starts_at, starts_at + 1 h) contains `now`, or null when no hour does: before the first hour, from the end
 * of the last, on another day (yesterday's forecast still in the cache), an empty list, or a `now` that is not a valid date.
 * The hours need not be in order, and one whose `starts_at` cannot be read is skipped. Returns the element itself.
 */
export function currentHour(hours: readonly HourForecast[], now: Date): HourForecast | null {
  const at = now.getTime();
  return (
    hours.find((hour) => {
      const start = Date.parse(hour.starts_at);
      return start <= at && at < start + HOUR_MS;
    }) ?? null
  );
}

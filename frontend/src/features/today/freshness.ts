import type { components } from "@/api/schema";

/*
 * Review focus 3 of the plan: a forecast from yesterday must never look live. Two pure questions about the forecast the
 * Today screen holds, answered from its own timestamps and the phone's clock (nothing here reads the clock: `now` is an
 * input, so the same call gives the same answer in a test and on a phone).
 *
 *   freshness   was it made recently enough to be trusted without saying when?
 *   currentHour does it cover the present at all?
 *
 * Neither looks at when the response arrived: the service worker answers offline with a cached copy, and that arrival
 * time is "now" while the forecast is old. Only the forecast's own `generated_at` and `starts_at` count.
 */

type HourForecast = components["schemas"]["HourForecast"];

export type Freshness = "fresh" | "stale";

const HOUR_MS = 60 * 60 * 1000;

/**
 * A forecast made longer ago than this is stale: the screen then says when it was last updated. A display rule, kept here
 * and nowhere else; it is not a risk parameter (those come from the API, ADR 0010).
 */
export const STALE_AFTER_MS = 3 * HOUR_MS;

/**
 * Whether a forecast generated at `generatedAt` (ISO 8601, as the API writes it) is fresh at `now`: "stale" when it is
 * older than three hours, so exactly three hours old is still fresh.
 *
 * It errs towards "stale": a `generatedAt` that cannot be read as a time, or a `now` that is not a valid date, cannot be
 * vouched for. A stamp ahead of the phone's clock is fresh (ordinary clock skew); the phone's clock being wrong by hours is
 * not something this can see.
 */
export function freshness(generatedAt: string, now: Date): Freshness {
  const ageMs = now.getTime() - Date.parse(generatedAt);
  return ageMs <= STALE_AFTER_MS ? "fresh" : "stale";
}

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

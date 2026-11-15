import type { components } from "@/api/schema";

/*
 * Review focus 3 of the plan: a forecast from yesterday must never look live. Whether the forecast a screen holds may be
 * drawn as live, from its own `mode`, `forecast_status` and `generated_at` and the clock the screen treats as now (nothing
 * here reads the clock: `now` is an input, so the same call gives the same answer in a test and on a phone). Shared by the
 * worker's Today and alert and the supervisor's crews; whether a forecast covers the present at all is `currentHour`
 * (features/today/freshness.ts).
 *
 * It never looks at when the response arrived: the service worker answers offline with a cached copy, and that arrival
 * time is "now" while the forecast is old.
 */

type SiteForecastToday = components["schemas"]["SiteForecastToday"];

const HOUR_MS = 60 * 60 * 1000;

export type Freshness = "fresh" | "stale";

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
 * Whether the forecast the screen holds may be drawn as live, from the API's own account of it and the clock.
 *
 *   mode "replay"  the API serves a fixed snapshot and says so through `forecast_status` ("never stale" is its contract).
 *                  `generated_at` there is the newest run time of the stored rows, which for a day-1 forecast is about a day
 *                  before the replay date, and `now` is the replay clock: the 3 hour rule would read every replay day as
 *                  stale. So the status alone decides: "fresh" is fresh; "stale" and "fallback" are never drawn as live.
 *   mode "live"    both count: the 3 hour rule against `generated_at` AND the status. Whichever says "not fresh" wins, and a
 *                  "fallback" (no usable forecast) is not fresh either.
 *
 * `Freshness` has two values on purpose: the screens that need to tell "stale" from "fallback" read `forecast_status` itself.
 */
export function forecastFreshness(forecast: Pick<SiteForecastToday, "mode" | "forecast_status" | "generated_at">, now: Date): Freshness {
  if (forecast.forecast_status !== "fresh") return "stale";
  return forecast.mode === "replay" ? "fresh" : freshness(forecast.generated_at, now);
}

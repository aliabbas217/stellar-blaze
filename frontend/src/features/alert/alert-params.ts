import type { components } from "@/api/schema";
import type { Level } from "@/components/level/level";
import { isAudience, isIsoDateTime, isLevel, type PushAudience } from "@/features/push/payload";

/*
 * The alert card's two pure questions (F2 Task 17): which warning is this, and which stretch of the day does it cover.
 *
 * The notification a worker taps carries the warning's identity in its query (notificationTargetUrl, ADR 0058): who it was
 * for (a site or a crew), which one, the level, and when it applies. The card is opened by a tap from outside the app, so the
 * query is input from outside and is checked, not trusted; anything that is not a warning this app could have sent opens Today.
 */

type HourForecast = components["schemas"]["HourForecast"];
type CrewHour = components["schemas"]["CrewHour"];

export interface AlertParams {
  readonly audience: PushAudience;
  /** The site id for a site alert, the crew id for a crew alert. */
  readonly targetId: string;
  readonly level: Level;
  /** ISO 8601 date-time, as the payload wrote it. */
  readonly validFrom: string;
}

/** What Next.js hands a page, or the browser's own: a value, a repeated value, or nothing. */
type SearchSource = URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;

// An id is a slug the API wrote: letters, digits and a few separators. No slash, no dot-dot: it ends up in a request path.
const TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function read(search: SearchSource, key: string): string | null {
  if (search instanceof URLSearchParams) return search.get(key);
  const value = search[key];
  return typeof value === "string" ? value : null;
}

/** The alert the query describes, or null when any value is missing, repeated, unknown or malformed. */
export function parseAlertParams(search: SearchSource): AlertParams | null {
  const audience = read(search, "audience");
  const targetId = read(search, "target");
  const level = read(search, "level");
  const validFrom = read(search, "valid_from");
  if (!isAudience(audience) || !isLevel(level) || !isIsoDateTime(validFrom)) return null;
  if (targetId === null || !TARGET_ID.test(targetId)) return null;
  return { audience, targetId, level, validFrom };
}

export interface AlertWindow {
  /** The level the forecast has for the warning's first hour: the card tells the truth when the forecast has moved since the push. */
  readonly level: Level;
  /** The start of the first hour of the run, ISO 8601 (UTC, as the API writes it). */
  readonly from: string;
  /** The end of the last consecutive hour at this level; null when the run reaches the end of the forecast and may go on. */
  readonly to: string | null;
  /** The level of the hour just before the run, or null when there is none (the first hour of the forecast, or a gap). */
  readonly previous: Level | null;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The stretch of the day an alert covers: the run of hours at one level from the hour that contains `validFrom`. Null when no
 * hour contains it, that hour has no level (a fallback hour), `validFrom` cannot be read, or there are no hours.
 */
export function alertWindow(hours: readonly HourForecast[], validFrom: string): AlertWindow | null {
  const at = Date.parse(validFrom);
  if (Number.isNaN(at)) return null;
  const byStart = new Map(hours.map((hour) => [Date.parse(hour.starts_at), hour] as const));
  const first = hours.find((hour) => {
    const start = Date.parse(hour.starts_at);
    return start <= at && at < start + HOUR_MS;
  });
  const level = first?.site_level ?? null;
  if (first === undefined || level === null) return null;

  const start = Date.parse(first.starts_at);
  let end = start + HOUR_MS;
  for (let next = byStart.get(end); next !== undefined && next.site_level === level; next = byStart.get(end)) end += HOUR_MS;

  const last = Math.max(...hours.map((hour) => Date.parse(hour.starts_at)));
  return {
    level,
    from: new Date(start).toISOString(),
    // The run ends at `end` unless its last hour is the last hour the forecast has: then nothing says it ends.
    to: end - HOUR_MS >= last ? null : new Date(end).toISOString(),
    previous: byStart.get(start - HOUR_MS)?.site_level ?? null,
  };
}

/**
 * A crew's hours as the shape `alertWindow` reads: the crew's level stands where the site's does. A crew alert asks the same
 * question of the crew's own timeline (its level carries a stop), and a missing level stays missing.
 */
export function crewHoursAsForecast(hours: readonly CrewHour[]): HourForecast[] {
  return hours.map((hour) => ({
    starts_at: hour.starts_at,
    site_level: hour.crew_level,
    wbgt_c: { p05: null, p50: null, p95: null },
    action_codes: [],
    ban_active: hour.ban_active,
  }));
}

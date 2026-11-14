import type { components } from "@/api/schema";
import type { Level } from "@/components/level/level";
import type { BanState } from "@/components/spine/ban-state";
import { currentHour } from "@/features/today/freshness";

/*
 * The pure schedule arithmetic of the Today screen: where "now" sits on the site's day, how long the level holds, the
 * waypoints of the spine and the age of a forecast. Nothing here reads a clock or a locale: `now` and the zone are inputs,
 * so a test and a phone agree, and every label is a message key the view fills (the words are not here).
 */

type HourForecast = components["schemas"]["HourForecast"];

const HOUR_MS = 60 * 60 * 1000;

/** Hours since local midnight in `zone` at `at`, fractional: 11:10 is 11.1667. */
export function hourOfDay(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
  return get("hour") + get("minute") / 60;
}

/** The site-local calendar date, `YYYY-MM-DD`. */
export function localDate(at: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * `MM-DD` as "15 Sep": day first, in the reader's language, Western digits (the house style of every date label). The year
 * is a leap year so 02-29 reads; the day-month pair names no year.
 */
export function formatMonthDay(monthDay: string, locale: string): string {
  const match = /^(\d{2})-(\d{2})$/.exec(monthDay);
  if (match === null) return monthDay;
  const date = new Date(Date.UTC(2000, Number(match[1]) - 1, Number(match[2])));
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", timeZone: "UTC" };
  if (locale !== "en") return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, options).format(date);
  // English: "15 Sep", day first. en-GB writes September "Sept", and the copy writes "Sep", so the month comes from en-US
  // and the order is set here.
  const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month")}`;
}

export interface LevelRun {
  readonly level: Level;
  /** The end of the last consecutive hour at this level (the forecast's own edge when the run reaches the end of it). */
  readonly endsAt: Date;
}

/**
 * How long the site level at `now` holds: the consecutive hours from the current one that carry the same level. Null when
 * no hour covers `now` or the current hour has no level (a fallback hour). An hour out of sequence ends the run: a gap in
 * the forecast is not "the same level".
 */
export function levelRun(hours: readonly HourForecast[], now: Date): LevelRun | null {
  const current = currentHour(hours, now);
  if (current === null || current.site_level === null) return null;
  const starts = new Map(hours.map((hour) => [Date.parse(hour.starts_at), hour] as const));
  let end = Date.parse(current.starts_at) + HOUR_MS;
  for (let next = starts.get(end); next !== undefined && next.site_level === current.site_level; next = starts.get(end)) {
    end += HOUR_MS;
  }
  return { level: current.site_level, endsAt: new Date(end) };
}

export interface AgeParts {
  readonly hours: number;
  readonly minutes: number;
}

/** `ms` as whole hours and minutes (rounded down; never negative, so a stamp ahead of the clock reads as "0 min"). */
export function ageParts(ms: number): AgeParts {
  const total = Math.max(0, Math.floor(ms / 60_000));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** A waypoint of the spine, as a kind and a time: the view words it. `at` is an hour of the site's day. */
export type WaypointSpec =
  | { readonly kind: "now"; readonly at: number }
  | { readonly kind: "breakIn"; readonly at: number; readonly minutes: number }
  | { readonly kind: "backToWork"; readonly at: number }
  | { readonly kind: "shiftEnds"; readonly at: number }
  | { readonly kind: "noBreak"; readonly at: number };

/** Where the "no midday break" note sits when the window does not say: the middle of the usual break. */
const NO_BREAK_AT = 12.75;

/**
 * The waypoints of the day: Now; Break in X and Back to work only where the midday break is in force and still ahead;
 * a note instead where it is not in force (no slot is drawn then); Shift ends only when the crew has a shift
 * (`shiftEndHour` is null otherwise, and nothing is invented). In time order. With no `nowHour` (the forecast is for another
 * day than today) there is nothing to count from: no waypoints.
 */
export function waypointSpecs(input: {
  readonly nowHour: number | null;
  readonly ban: BanState;
  readonly shiftEndHour: number | null;
  readonly from: number;
  readonly to: number;
}): WaypointSpec[] {
  const { nowHour, ban, shiftEndHour, from, to } = input;
  if (nowHour === null) return [];
  const specs: WaypointSpec[] = [];
  if (nowHour >= from && nowHour <= to) specs.push({ kind: "now", at: nowHour });

  if (ban.kind === "in-force") {
    if (nowHour < ban.fromHour) specs.push({ kind: "breakIn", at: ban.fromHour, minutes: Math.max(1, Math.round((ban.fromHour - nowHour) * 60)) });
    if (nowHour < ban.toHour) specs.push({ kind: "backToWork", at: ban.toHour });
  } else {
    specs.push({ kind: "noBreak", at: ban.outline === null ? NO_BREAK_AT : (ban.outline.fromHour + ban.outline.toHour) / 2 });
  }

  if (shiftEndHour !== null && shiftEndHour > nowHour && shiftEndHour <= to) specs.push({ kind: "shiftEnds", at: shiftEndHour });
  return specs.sort((a, b) => a.at - b.at);
}

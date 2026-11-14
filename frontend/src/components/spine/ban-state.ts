import type { components } from "@/api/schema";

/*
 * Whether the midday break is in force on the date a spine draws, and where. The one input is the API's `ban_window`
 * (frozen B3 v1 contract): the instants are the only source of the slot's edges, converted to the site's zone. Nothing
 * here knows 12:30 or 15:00 or 15 June, and `active_on_date` is not read: the window and the date decide, so a client
 * can never draw a slot the data does not support (F2 review focus 2).
 */

type ApiBanWindow = components["schemas"]["BanWindow"];

/** The part of the generated `BanWindow` this module reads. The generated type is assignable to it. */
export type BanWindowInput = Pick<
  ApiBanWindow,
  "starts_at" | "ends_at" | "season_start" | "season_end" | "start" | "end" | "timezone"
> &
  Partial<Pick<ApiBanWindow, "active_on_date">>;

/** An hour of the site's day, fractional: 12.5 is 12:30. */
export interface HourRange {
  readonly fromHour: number;
  readonly toHour: number;
}

export type BanState =
  | ({ readonly kind: "in-force" } & HourRange)
  | {
      readonly kind: "not-in-force";
      /** "15 Jun" in the reader's language with Western digits: when the break next applies, or null when unknown. */
      readonly resumesLabel: string | null;
      /**
       * Where the break would sit, from the window's own `HH:MM` strings, for the dashed outline a desk axis draws when
       * the break is not in force. Null when the window is absent or unreadable.
       */
      readonly outline: HourRange | null;
    };

const NOT_IN_FORCE_NO_WINDOW: BanState = { kind: "not-in-force", resumesLabel: null, outline: null };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_DAY = /^(\d{2})-(\d{2})$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Hours since midnight in `zone` for an ISO instant, plus the local calendar date; null for a string that is not an instant. */
function localParts(iso: string, zone: string): { date: string; hour: number } | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) + Number(get("minute")) / 60,
  };
}

function hhmmToHour(value: string): number | null {
  const m = HHMM.exec(value);
  return m === null ? null : Number(m[1]) + Number(m[2]) / 60;
}

/** `MM-DD` is inside the season; both ends inclusive, and a season that wraps the new year (start after end) is allowed. */
function inSeason(monthDay: string, start: string, end: string): boolean {
  return start <= end ? monthDay >= start && monthDay <= end : monthDay >= start || monthDay <= end;
}

/**
 * "15 Jun": the day-month order the UAE copy and the prototype use, in the reader's language, always Western digits
 * (`-u-nu-latn`): numerals never switch script. English is formatted as en-GB for the order (day first, as in 24-hour
 * times written 12:30), not for spelling.
 */
function formatMonthDay(year: number, month: number, day: number, locale: string): string {
  const tag = locale === "en" ? "en-GB" : locale;
  return new Intl.DateTimeFormat(`${tag}-u-nu-latn`, { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/** When the break next applies, for a date outside the season; null when the date is inside it or anything is unreadable. */
function resumesOn(win: BanWindowInput, date: string, locale: string): string | null {
  const day = DATE.exec(date);
  const start = MONTH_DAY.exec(win.season_start);
  if (day === null || start === null || !MONTH_DAY.test(win.season_end)) return null;
  const monthDay = `${day[2] ?? ""}-${day[3] ?? ""}`;
  if (inSeason(monthDay, win.season_start, win.season_end)) return null;
  const year = Number(day[1]);
  // before this year's start: this year; after this year's end: next year
  const resumeYear = monthDay < win.season_start ? year : year + 1;
  return formatMonthDay(resumeYear, Number(start[1]), Number(start[2]), locale);
}

/**
 * The ban state a spine draws on `date` (`YYYY-MM-DD`, the site-local date the hours belong to).
 *
 * In force only when the window is present, the date is inside the season, both instants are set and fall on `date`
 * in `tz` with the end after the start. Anything else (no window, a null instant, a date outside the season, an
 * unreadable value) is not in force: a missing signal never draws a slot. `tz` is the site's zone (the window's own
 * `timezone`); `locale` only words the resume date.
 */
export function banStateFrom(
  window: BanWindowInput | null | undefined,
  tz: string,
  date: string,
  locale = "en",
): BanState {
  if (window === null || window === undefined) return NOT_IN_FORCE_NO_WINDOW;

  const from = hhmmToHour(window.start);
  const to = hhmmToHour(window.end);
  const outline = from !== null && to !== null && to > from ? { fromHour: from, toHour: to } : null;
  const notInForce: BanState = { kind: "not-in-force", resumesLabel: resumesOn(window, date, locale), outline };

  const day = DATE.exec(date);
  const season = MONTH_DAY.test(window.season_start) && MONTH_DAY.test(window.season_end);
  if (day === null || !season || !inSeason(`${day[2] ?? ""}-${day[3] ?? ""}`, window.season_start, window.season_end)) {
    return notInForce;
  }
  if (window.starts_at === null || window.ends_at === null) return notInForce;

  const starts = localParts(window.starts_at, tz);
  const ends = localParts(window.ends_at, tz);
  if (starts === null || ends === null) return notInForce;
  if (starts.date !== date || ends.date !== date || ends.hour <= starts.hour) return notInForce;
  return { kind: "in-force", fromHour: starts.hour, toHour: ends.hour };
}

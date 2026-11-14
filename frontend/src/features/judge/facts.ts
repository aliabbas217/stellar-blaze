import { z } from "zod";
import type { components } from "@/api/schema";
import type { TallyPoint } from "@/components/charts/tally";

/*
 * What the forecast file says about the season, counted in the browser's own code and never typed in. The file is the
 * recorded day-1 IFS forecast for the demo station (data/static/omaa_2026_ifs_d1_wbgt_hourly.json): it is a forecast,
 * not a scored result, so these counts carry a RECORDED proof, never a "result" label.
 *
 * The midday break is an input: this module knows no date or hour of it. The page passes the ban window of the API
 * contract (`BanWindow`: season as MM-DD both ends inclusive, start and end as site-local HH:MM, end exclusive).
 */

type BanWindow = components["schemas"]["BanWindow"];

/** The part of the API's `BanWindow` the counts read. The generated type is assignable to it. */
export type SeasonBan = Pick<BanWindow, "season_start" | "season_end" | "start" | "end">;

/**
 * The hours the season counts: hour starts 06 to 18 local, thirteen hours a day (06:00 to 19:00). This is what the
 * approved prototype counts and what "1,807 working hours" means; it is a display definition of the judge screens, not
 * a safety value.
 */
export const WORK_HOURS: { readonly from: number; readonly to: number } = { from: 6, to: 19 };

const hourlySchema = z
  .object({
    station: z.string(),
    source: z.string(),
    tz: z.string(),
    days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
    wbgt_c_by_local_hour: z.array(z.array(z.number().nullable()).min(WORK_HOURS.to)).min(1),
  })
  .refine((s) => s.days.length === s.wbgt_c_by_local_hour.length, { message: "days and hours do not line up" });

export type HourlySeries = z.infer<typeof hourlySchema>;

/** Parses the hourly forecast file; throws a ZodError naming the problem when it is not the shape above. */
export function parseHourlySeries(value: unknown): HourlySeries {
  return hourlySchema.parse(value);
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function clockHour(value: string): number {
  const match = HHMM.exec(value);
  if (match === null) throw new RangeError(`not an HH:MM time: ${value}`);
  return Number(match[1]) + Number(match[2]) / 60;
}

/** Index of the first and the last day inside the ban season, or null when no day of the series is in it. */
function seasonIndexes(days: readonly string[], ban: SeasonBan): { readonly from: number; readonly to: number } | null {
  let from = -1;
  let to = -1;
  days.forEach((day, i) => {
    const monthDay = day.slice(5);
    if (monthDay >= ban.season_start && monthDay <= ban.season_end) {
      if (from < 0) from = i;
      to = i;
    }
  });
  return from < 0 ? null : { from, to };
}

interface Scan {
  readonly n: number;
  readonly perDay: number[];
  readonly inBanPerDay: number[];
  readonly peaks: number[];
  readonly span: { readonly from: number; readonly to: number } | null;
}

function scan(series: HourlySeries, ban: SeasonBan, limit: number): Scan {
  const span = seasonIndexes(series.days, ban);
  const breakFrom = clockHour(ban.start);
  const breakTo = clockHour(ban.end);
  let n = 0;
  const perDay: number[] = [];
  const inBanPerDay: number[] = [];
  const peaks: number[] = [];
  series.wbgt_c_by_local_hour.forEach((row, i) => {
    let over = 0;
    let inside = 0;
    const inSeason = span !== null && i >= span.from && i <= span.to;
    for (let h = WORK_HOURS.from; h < WORK_HOURS.to; h++) {
      const value = row[h];
      if (value === null || value === undefined) continue;
      n++;
      if (value > limit) {
        over++;
        // The hour [h, h + 1) is inside the break when it overlaps [start, end): 12:30 touches the whole 12:00 hour.
        if (inSeason && h + 1 > breakFrom && h < breakTo) inside++;
      }
    }
    perDay.push(over);
    inBanPerDay.push(inside);
    const present = row.filter((v): v is number => v !== null);
    peaks.push(Math.max(...present));
  });
  return { n, perDay, inBanPerDay, peaks, span };
}

export interface SeasonFacts {
  /** Working hours that have a forecast value. */
  readonly n: number;
  /** Of those, hours above the limit. */
  readonly over: number;
  /** Of those, hours above the limit that fall inside the midday break. */
  readonly inBan: number;
  /** The highest forecast of each day (any hour). */
  readonly peaks: readonly number[];
  /** Working hours above the limit, per day. */
  readonly perDay: readonly number[];
  readonly pk: number;
  readonly pkI: number;
  /** Local hour of the season's highest forecast. */
  readonly pkH: number;
  readonly lo: number;
  readonly loI: number;
  /** Days whose peak is above the limit. */
  readonly daysOver: number;
  /** First and last day index inside the ban season; null when the series has none. */
  readonly ban: { readonly fromIndex: number; readonly toIndex: number } | null;
}

/** The counts the season ribbon and its tally show, from the forecast series and the ban window. */
export function seasonFacts(series: HourlySeries, ban: SeasonBan, limit: number): SeasonFacts {
  const { n, perDay, inBanPerDay, peaks, span } = scan(series, ban, limit);
  const pk = Math.max(...peaks);
  const lo = Math.min(...peaks);
  const pkI = peaks.indexOf(pk);
  const loI = peaks.indexOf(lo);
  return {
    n,
    over: perDay.reduce((a, b) => a + b, 0),
    inBan: inBanPerDay.reduce((a, b) => a + b, 0),
    peaks,
    perDay,
    pk,
    pkI,
    pkH: series.wbgt_c_by_local_hour[pkI]?.indexOf(pk) ?? 0,
    lo,
    loI,
    daysOver: peaks.filter((p) => p > limit).length,
    ban: span === null ? null : { fromIndex: span.from, toIndex: span.to },
  };
}

export type { TallyPoint };

/** The running totals through each day, for the player's counters: entry `i` is the tally through day `i`. */
export function cumulativeTally(series: HourlySeries, ban: SeasonBan, limit: number): readonly TallyPoint[] {
  const { perDay, inBanPerDay, peaks } = scan(series, ban, limit);
  let days = 0;
  let hours = 0;
  let inside = 0;
  return peaks.map((peak, i) => {
    if (peak > limit) days++;
    hours += perDay[i] ?? 0;
    inside += inBanPerDay[i] ?? 0;
    return { days, hours, inBan: inside };
  });
}

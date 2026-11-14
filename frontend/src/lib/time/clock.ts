/*
 * The demo clock's one calculation: the UTC instant at which a site's wall clock reads `hhmm` on `date`. The replay
 * moment of every screen is derived from it (F2 review focus 6: the API's date at 11:10 in the site's zone), so it
 * follows the zone's real offset on that day (Intl, the browser's tz database) and never a fixed "+04:00".
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * `raw` when it is a 24-hour time written `HH:MM` with leading zeros, else null. Reads the `?at=` override of the demo
 * clock; a malformed value is "no override", never a thrown error on a shared link.
 */
export function parseHhmm(raw: string | null): string | null {
  return raw !== null && HHMM.test(raw) ? raw : null;
}

/** How far `zone` is ahead of UTC at the instant `at`, in milliseconds. */
function offsetMs(at: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asIfUtc - Math.floor(at / 1000) * 1000;
}

/**
 * The instant of local `hhmm` on `date` (`YYYY-MM-DD`) in the IANA zone `zone`: `("2026-09-03", "11:10", "Asia/Dubai")`
 * is 07:10Z. The offset is read at the instant itself, so a zone with daylight saving is right on either side of a
 * change; a local time that does not exist (the hour skipped in spring) or exists twice (autumn) resolves to one of
 * the two readings, which cannot matter for a UAE site.
 *
 * @throws RangeError for a date that is not a calendar date, a time that is not `HH:MM`, or an unknown zone.
 */
export function replayInstant(date: string, hhmm: string, zone: string): Date {
  const day = DATE.exec(date);
  const time = HHMM.exec(hhmm);
  if (day === null) throw new RangeError(`Not a YYYY-MM-DD date: ${date}`);
  if (time === null) throw new RangeError(`Not an HH:MM time: ${hhmm}`);
  const [year, month, dayOfMonth] = [Number(day[1]), Number(day[2]), Number(day[3])];
  const local = Date.UTC(year, month - 1, dayOfMonth, Number(time[1]), Number(time[2]));
  const check = new Date(local);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== dayOfMonth) {
    throw new RangeError(`Not a calendar date: ${date}`);
  }
  // The offset at the guess is only right when the guess is on the same side of a change as the answer; reading it
  // again at the first answer settles the two days a year where it is not.
  const first = local - offsetMs(local, zone);
  return new Date(local - offsetMs(first, zone));
}

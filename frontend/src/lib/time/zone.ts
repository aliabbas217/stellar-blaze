/*
 * Two calendar questions about an instant in a site's zone, shared by every screen that places "now" on the site's day (the
 * worker's Today and the supervisor's crews). Pure: the instant and the IANA zone are inputs, nothing reads a clock.
 */

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

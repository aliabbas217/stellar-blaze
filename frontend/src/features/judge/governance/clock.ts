/*
 * The clock times of the governance sequence: the site's own zone (Asia/Dubai), Western digits in every locale, with seconds,
 * because the four steps happen within one second of each other and the order is the point.
 */

const SITE_ZONE = "Asia/Dubai";

function tagOf(locale: string): string {
  return `${locale === "en" ? "en-GB" : locale}-u-nu-latn`;
}

/** "14:02:11". */
export function clockTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(tagOf(locale), { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: SITE_ZONE }).format(
    new Date(iso),
  );
}

/** "15 Nov 2026, 14:02". */
export function dayAndTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(tagOf(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: SITE_ZONE,
  }).format(new Date(iso));
}

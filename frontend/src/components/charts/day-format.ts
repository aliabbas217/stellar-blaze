/**
 * Day and month names for the judge charts. English is written day first ("15 Sep", the UAE order) with the short month
 * names of en-US ("Sep": en-GB says "Sept"); every other language uses its own order. Digits are Western in every
 * language (`-u-nu-latn`), and dates are read as UTC calendar days (the files carry local dates, not instants).
 */
export interface DayFormat {
  readonly dayMonth: (iso: string) => string;
  readonly withWeekday: (iso: string) => string;
  readonly month: (iso: string) => string;
}

export function dayFormat(locale: string): DayFormat {
  const english = locale === "en";
  const tag = `${english ? "en-US" : locale}-u-nu-latn`;
  const make = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag, { ...options, timeZone: "UTC" });
  const dayMonth = make({ day: "numeric", month: "short" });
  const withWeekday = make({ weekday: "short", day: "numeric", month: "short" });
  const month = make({ month: "short" });
  const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
  const dayFirst = (iso: string, weekday: boolean): string => {
    const parts = (weekday ? withWeekday : dayMonth).formatToParts(at(iso));
    const pick = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
    return `${weekday ? `${pick("weekday")} ` : ""}${pick("day")} ${pick("month")}`;
  };
  return {
    dayMonth: (iso) => (english ? dayFirst(iso, false) : dayMonth.format(at(iso))),
    withWeekday: (iso) => (english ? dayFirst(iso, true) : withWeekday.format(at(iso))),
    month: (iso) => month.format(at(iso)),
  };
}

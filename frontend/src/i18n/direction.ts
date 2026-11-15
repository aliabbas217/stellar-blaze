import type { Locale } from "./routing";

export type Direction = "ltr" | "rtl";

// Exhaustive on purpose: a new locale does not compile until its direction is decided.
const DIRECTION: Readonly<Record<Locale, Direction>> = {
  en: "ltr",
  ar: "rtl",
  ur: "rtl",
  hi: "ltr",
  bn: "ltr",
  ne: "ltr",
};

/** Writing direction for `<html dir>`. Static, never derived from the browser. */
export function dirFor(locale: Locale): Direction {
  return DIRECTION[locale];
}

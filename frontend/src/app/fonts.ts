import {
  Barlow_Condensed,
  Noto_Naskh_Arabic,
  Noto_Nastaliq_Urdu,
  Noto_Sans,
  Noto_Sans_Arabic,
  Noto_Sans_Bengali,
  Noto_Sans_Devanagari,
} from "next/font/google";
import type { Locale } from "@/i18n/routing";

/*
 * Per-script fonts (DESIGN.md, Typography). next/font downloads them at build time and serves them
 * from our own origin, so nothing is fetched from Google at runtime.
 *
 * Two CSS variables, exactly: --font-display and --font-body (globals.css builds the font-display
 * and font-body utilities on them; a Tailwind theme key with the same name would self-reference).
 * Every locale's body family declares --font-body, and only the class of the active locale is put on
 * <html>, so a browser only downloads the font files of the language on screen. The one exception
 * is Urdu, which chains a second family: Naskh as the fallback behind Nastaliq, in --font-body-secondary
 * (next/font takes literals only, so the chain cannot be built inside one declaration).
 *
 * Preload: next/font records preloads per route entry, not per locale, so `preload: true` on the body
 * families would make every page preload all of them (measured in .next/server/next-font-manifest.json
 * of this build: 14 files, about 950 KB, of which the Nastaliq Arabic-script file alone is 234 KB, on
 * /en too). Only the display face, which draws the Western-digit numerals in every language, is
 * preloaded (3 Latin files, 45 KB). A body family is fetched when its text is first painted: its
 * @font-face rules are unicode-range scoped and the other locales' classes are never applied. `display:
 * swap` and next/font's size-adjusted fallback keep the swap from shifting the layout. Per-locale
 * preload is parked for the Lighthouse and design gates (see the task report).
 *
 * Every call below must stay a literal call assigned to a module-level const: next/font reads them at build time.
 * Weights: Barlow Condensed is static (500, 600, 700). The body families are variable fonts
 * (weight 400 to 700 and beyond, one file per script), except Nastaliq, which the design pins to 400 and 700.
 * Each family's CSS carries its own Latin face, so digits, times and units (always Western digits) are
 * drawn by the family of the surrounding text. `subsets` only chooses what would be preloaded; it is
 * kept so turning preload on for a locale is a one-word change.
 */

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const sans = Noto_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
  preload: false,
});

const arabic = Noto_Sans_Arabic({
  subsets: ["arabic", "latin"],
  variable: "--font-body",
  display: "swap",
  preload: false,
});

const nastaliq = Noto_Nastaliq_Urdu({
  subsets: ["arabic", "latin"],
  weight: ["400", "700"],
  variable: "--font-body",
  display: "swap",
  preload: false,
});

const naskh = Noto_Naskh_Arabic({
  subsets: ["arabic", "latin"],
  variable: "--font-body-secondary",
  display: "swap",
  preload: false,
});

const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari", "latin"],
  variable: "--font-body",
  display: "swap",
  preload: false,
});

const bengali = Noto_Sans_Bengali({
  subsets: ["bengali", "latin"],
  variable: "--font-body",
  display: "swap",
  preload: false,
});

// Exhaustive on purpose: a new locale does not compile until its body family is chosen.
const BODY_CLASS: Readonly<Record<Locale, string>> = {
  en: sans.variable,
  ar: arabic.variable,
  ur: `${nastaliq.variable} ${naskh.variable}`,
  hi: devanagari.variable,
  bn: bengali.variable,
  ne: devanagari.variable,
};

/** Classes for `<html>`: the display face plus the body family (and Urdu's fallback) of this locale. */
export function fontClassFor(locale: Locale): string {
  return `${display.variable} ${BODY_CLASS[locale]}`;
}

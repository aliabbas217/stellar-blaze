import { defineRouting } from "next-intl/routing";

/**
 * Name of the cookie the proxy sets from the URL prefix. It is next-intl's default, written out because
 * next-intl does not expose its resolved routing config, and the not-found page (which has no route
 * parameter) must read the very cookie the proxy writes.
 */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

/**
 * The six supported locales. `en` is the source language and the default; `ar` and `ur` are
 * right-to-left (see direction.ts). Adding a locale means a messages file, a direction, a font
 * and a loader in request.ts: each of those is an exhaustive Record, so the compiler lists what is missing.
 */
export const routing = defineRouting({
  locales: ["en", "ar", "ur", "hi", "bn", "ne"],
  defaultLocale: "en",
  localeCookie: { name: LOCALE_COOKIE_NAME, sameSite: "lax" },
  // The URL prefix is the only thing that picks the language, so `/` is a plain 307 to `/en` for every visitor. With
  // detection on, next-intl also reads Accept-Language and the cookie, and the root would answer differently per
  // browser: unreproducible for a judge who opens a shared link, and uncacheable. A reader picks a language with the
  // chips (LanguageChips); a stored choice (LocalePrefs) still applies on the URLs that carry a prefix.
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];

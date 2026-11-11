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
});

export type Locale = (typeof routing.locales)[number];

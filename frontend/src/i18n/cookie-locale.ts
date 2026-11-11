import { hasLocale } from "next-intl";
import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME, routing, type Locale } from "./routing";

/** A cookie value to a supported locale; anything else (absent, stale, tampered) is the default locale. */
export function localeFromCookieValue(value: string | undefined): Locale {
  return hasLocale(routing.locales, value) ? value : routing.defaultLocale;
}

/**
 * The locale of the current request for code that renders outside the [locale] layout (global-not-found),
 * where there is no route parameter: the proxy's locale cookie, else the default.
 */
export async function getCookieLocale(): Promise<Locale> {
  return localeFromCookieValue((await cookies()).get(LOCALE_COOKIE_NAME)?.value);
}

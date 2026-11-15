import { routing, type Locale } from "@/i18n/routing";

/*
 * Which offline page a request gets when the network is gone and nothing is cached for it.
 *
 * One page per locale, precached by the service worker (src/app/serwist/[path]/route.ts) and chosen by the
 * first segment of the path: an Urdu worker who opens /ur/supervisor offline must read Urdu, not English
 * (docs review focus 2). A path with no known locale gets the default locale's page.
 *
 * This file is pure (no Serwist, no DOM) so it can be unit tested and bundled into the service worker.
 * It lives in src/features/pwa and is imported only from src/app: shared code (components, api, lib, i18n)
 * must not import a feature (eslint.config.mjs, route-group isolation).
 */

/** The offline page of a locale. */
export function offlineUrl(locale: Locale): string {
  return `/${locale}/offline`;
}

/** Every offline page, one per locale: what the service worker precaches. */
export const OFFLINE_URLS: readonly string[] = routing.locales.map(offlineUrl);

/** The unwell call sheet of a locale: precached with the offline pages so it opens with no connection (F2 Task 18, safety). */
export function unwellUrl(locale: Locale): string {
  return `/${locale}/worker/unwell`;
}

/** Every unwell sheet, one per locale. */
export const UNWELL_URLS: readonly string[] = routing.locales.map(unwellUrl);

/**
 * The alert card's static shell of a locale (F2 W1, I3). A tap on a heat warning opens `/<locale>/worker/alert?audience=...`; the
 * page has no server-side query (AlertEntry reads it on the client), so this one HTML file serves every warning, and the service
 * worker matches the request to it with the query ignored (`ALERT_QUERY_PARAMS`).
 */
export function alertUrl(locale: Locale): string {
  return `/${locale}/worker/alert`;
}

/** Every alert shell, one per locale. */
export const ALERT_URLS: readonly string[] = routing.locales.map(alertUrl);

/**
 * The query parameters of the alert card that precache matching ignores (Serwist `ignoreURLParametersMatching`, which strips the
 * parameters whose NAME matches before looking for a precached URL). The four of a push notification's target (ADR 0058:
 * `audience`, `target`, `level`, `valid_from`) and the two replay overrides (`at`, `demo`). Deliberately a closed list and not
 * a match-all pattern: the framework's own `_rsc` parameter must stay in the key, or a client-side navigation to the page would be answered
 * with this HTML where it asked for the router payload. Applies to precache entries only; the runtime-caching allow-list (D2) is
 * untouched.
 */
export const ALERT_QUERY_PARAMS: readonly RegExp[] = [/^audience$/, /^target$/, /^level$/, /^valid_from$/, /^at$/, /^demo$/];

/**
 * What the service worker precaches next to the build's static files: the offline pages (the fallback), the unwell sheet (a worker
 * in trouble may open it with no signal, before this phone has ever been online on that page) and the alert card's shell (a
 * warning is tapped with the app closed, and may be tapped offline). All are static and the same for everyone, so caching them is
 * safe (ADR 0004); the runtime-caching allow-list (D2) is untouched.
 */
export const PRECACHE_URLS: readonly string[] = [...OFFLINE_URLS, ...UNWELL_URLS, ...ALERT_URLS];

/** The locale a path starts with: its first segment must be one of the routing locales exactly (they are lower case). */
function localeOf(pathname: string): Locale | undefined {
  const first = pathname.split("/")[1];
  return routing.locales.find((locale) => locale === first);
}

/** `/ur/worker` -> `/ur/offline`; `/xx/foo` and `/` -> the default locale's page. */
export function fallbackUrlFor(pathname: string): string {
  return offlineUrl(localeOf(pathname) ?? routing.defaultLocale);
}

/**
 * What Serwist's `fallbacks.entries` needs (the entry type is `{ url, matcher }`; the matcher receives the failed
 * request). Only a top-level document request gets an HTML page: an API call, image or script that fails must
 * keep failing, or the app would try to parse an HTML page as JSON.
 */
export interface OfflineFallback {
  readonly url: string;
  matcher(param: { readonly request: Pick<Request, "destination" | "url"> }): boolean;
}

/**
 * One entry per locale. Each matches a document request that `fallbackUrlFor` maps to its page, so a path with
 * no known locale lands on the default locale's entry and `fallbackUrlFor` stays the single place that decides.
 */
export function offlineFallbacks(): OfflineFallback[] {
  return routing.locales.map((locale) => ({
    url: offlineUrl(locale),
    matcher: ({ request }) =>
      request.destination === "document" && fallbackUrlFor(new URL(request.url).pathname) === offlineUrl(locale),
  }));
}

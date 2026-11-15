import { routing } from "@/i18n/routing";

/*
 * The one preference the service worker needs and cannot ask the page for when a push arrives: the language the
 * worker reads the app in. The page writes it to Cache Storage on every locale render (LocalePrefs); the worker reads
 * it when it shows a notification (docs review focus 2: an Urdu worker gets an Urdu notification and lands on /ur/...).
 *
 * Cache Storage, not localStorage: a service worker cannot read localStorage. It holds the locale code and nothing
 * else, so it is not personal data and `clearApiCaches` (api-cache.ts) rightly leaves it alone.
 */

export const PREFS_CACHE_NAME = "sb-prefs";
/** The key. It is never requested from the network: Cache Storage keys are URLs, and nothing serves this one. */
export const PREFS_PATH = "/__sb/prefs";

/** The part of `CacheStorage` this module uses; the real one satisfies it. */
export interface PrefsStorage {
  open(cacheName: string): Promise<{
    put(request: string, response: Response): Promise<void>;
    match(request: string): Promise<Response | undefined>;
  }>;
}

function defaultStorage(): PrefsStorage | undefined {
  return typeof caches === "undefined" ? undefined : caches;
}

/**
 * Stores the locale for the service worker. Rejects when Cache Storage fails; where it does not exist (an insecure
 * page, no browser) there is nothing to store to and it resolves.
 */
export async function writeLocalePref(locale: string, storage: PrefsStorage | undefined = defaultStorage()): Promise<void> {
  if (storage === undefined) return;
  const cache = await storage.open(PREFS_CACHE_NAME);
  await cache.put(PREFS_PATH, new Response(JSON.stringify({ locale }), { headers: { "content-type": "application/json" } }));
}

/**
 * The locale the page last stored, as stored (the caller decides whether it is supported), or the default locale when
 * nothing usable is there: never stored, unreadable, no Cache Storage. It never rejects: a notification must still be
 * shown, in English, when the preference is lost.
 */
export async function readLocalePref(storage: PrefsStorage | undefined = defaultStorage()): Promise<string> {
  try {
    if (storage === undefined) return routing.defaultLocale;
    const response = await (await storage.open(PREFS_CACHE_NAME)).match(PREFS_PATH);
    const stored: unknown = await response?.json();
    if (typeof stored === "object" && stored !== null && "locale" in stored && typeof stored.locale === "string") {
      return stored.locale;
    }
  } catch {
    // Unreadable or no storage: the default below. Nothing here may stop a notification from showing.
  }
  return routing.defaultLocale;
}

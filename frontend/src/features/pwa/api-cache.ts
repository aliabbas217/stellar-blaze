/*
 * What the service worker may keep of the API on the device, and how to remove it. Pure on purpose (no Serwist, no
 * DOM at import time): it is unit tested, bundled into the service worker, and imported by app code that must
 * clear the cache (the on-device profile store, features/profile/store.ts).
 *
 * The values are the cache's own tuning, not risk parameters: those come from the API, never from here.
 */

/** Name of the Cache Storage cache that holds the allow-listed responses. */
export const API_CACHE_NAME = "sb-api";

/**
 * Serwist's `defaultCache` fills a cache named "apis" with every same-origin /api/ GET. The worker no longer
 * routes anything to it (see runtime-caching.ts), but a phone that ran an earlier worker may still hold one, so
 * clearing the API caches deletes it too.
 */
const LEGACY_DEFAULT_API_CACHE_NAME = "apis";

/** Every Cache Storage cache that can hold an API response: what `clearApiCaches` deletes. */
export const API_CACHE_NAMES: readonly string[] = [API_CACHE_NAME, LEGACY_DEFAULT_API_CACHE_NAME];

/**
 * The caches Serwist's `defaultCache` fills with pages: the HTML ("pages"), the React Server Component payloads
 * ("pages-rsc", "pages-rsc-prefetch") and the same-origin catch-all ("others"). Their keys are URLs, and a worker's
 * page URL can carry the site (`?site=<id>`), so they say which site a phone looked at. The page contents are the
 * same for everyone (ADR 0004: nothing personal is rendered into a page), which is why the service worker may keep
 * them; the URL is why they go with the profile. The precache (`serwist-precache-*`: the offline pages and the
 * build's assets) and the static asset caches hold no URL of that kind and stay, so the app still opens offline.
 *
 * tests/unit/features/pwa/api-cache.test.ts reads the installed Serwist's `defaultCache` and fails if a name changes.
 */
export const DOCUMENT_CACHE_NAMES: readonly string[] = ["pages", "pages-rsc", "pages-rsc-prefetch", "others"];

/** Every cache `clearDeviceCaches` deletes: the API caches and the page caches. */
export const DEVICE_CACHE_NAMES: readonly string[] = [...API_CACHE_NAMES, ...DOCUMENT_CACHE_NAMES];

/** The network gets this long before the cached copy is used (a flaky mobile connection, not only no connection). */
export const API_CACHE_NETWORK_TIMEOUT_SECONDS = 4;

/** A cached copy older than this is dropped: two days covers a shift without signal, no more. */
export const API_CACHE_MAX_AGE_SECONDS = 48 * 60 * 60;

/** One forecast per site the worker looked at, and the policy. */
export const API_CACHE_MAX_ENTRIES = 20;

/**
 * GOVERNANCE INVARIANT (ADR 0004, ADR 0009): the whole list of API responses the app may keep on the device.
 *
 * Both are the same for everyone at a site (a site forecast, the risk policy) and say nothing about a worker.
 * Workers can share a phone, so nothing else under /api/ may ever reach Cache Storage: the service worker sends
 * every other /api/ request to the network (runtime-caching.ts) and a unit test resolves real requests through
 * Serwist's router to prove it. Adding a pattern here is a governance decision: decide it in an ADR first, then
 * change this list and the pin in tests/unit/features/pwa/api-cache.test.ts together.
 */
export const OFFLINE_API_ALLOW_LIST: readonly RegExp[] = [
  // One path segment for the site id: `a/b` or an empty id is not a site.
  /^\/api\/v1\/sites\/[^/]+\/forecast\/today$/,
  /^\/api\/v1\/risk-policy$/,
];

/** Whether this same-origin path is on the allow-list. Query strings are not part of a pathname. */
export function isCachedApiPath(pathname: string): boolean {
  return OFFLINE_API_ALLOW_LIST.some((pattern) => pattern.test(pathname));
}

type DeletableCaches = Pick<CacheStorage, "delete">;

async function deleteCaches(names: readonly string[], storage: DeletableCaches | undefined): Promise<void> {
  if (storage === undefined) return;
  const results = await Promise.allSettled(names.map((name) => storage.delete(name)));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed !== undefined) throw failed.reason;
}

/**
 * Deletes every cache that can hold an API response. It only touches the API caches: pages and the precache stay, so
 * the app still opens offline. `clearDeviceCaches` is what the profile store calls; this is the narrower half of it.
 *
 * Every deletion is attempted; if any fails the returned promise rejects with the first failure, because a caller
 * that is withdrawing consent must not report success while data may remain. Where Cache Storage does not exist
 * (a page that is not a secure context, or no browser) there is nothing to delete and it resolves.
 */
export async function clearApiCaches(
  storage: DeletableCaches | undefined = typeof caches === "undefined" ? undefined : caches,
): Promise<void> {
  await deleteCaches(API_CACHE_NAMES, storage);
}

/**
 * Deletes every cache that can hold an API response or a page URL (`DEVICE_CACHE_NAMES`). Call it from the page when a
 * worker takes consent back or changes their site (features/profile/store.ts does both), so that what the worker's
 * phone remembers of the app goes with the profile. Same guarantees as `clearApiCaches`: every deletion is attempted,
 * the first failure is thrown, and without Cache Storage it resolves.
 */
export async function clearDeviceCaches(
  storage: DeletableCaches | undefined = typeof caches === "undefined" ? undefined : caches,
): Promise<void> {
  await deleteCaches(DEVICE_CACHE_NAMES, storage);
}

/**
 * The IndexedDB database in which Serwist's `ExpirationPlugin` records, for every cache it expires (the API cache and
 * each of `DOCUMENT_CACHE_NAMES` and more), the URL and the fetch time of each cached entry (serwist 9.5.13,
 * `CacheTimestampsModel`: `DB_NAME`, object store "cache-entries"). Those URLs name the sites a worker looked at.
 * `clearDeviceCaches` does not touch it. tests/unit/features/pwa/api-cache.test.ts reads the installed Serwist's source
 * and fails if the name changes.
 */
export const EXPIRATION_DB_NAME = "serwist-expiration";

/** "cleared": the rows are gone. "absent": there was no such database (or no IndexedDB), so there was nothing to clear. */
export type MetadataClearing = "cleared" | "absent";

/** One attempt at emptying every object store of the database; rejects with whatever IndexedDB reports. */
function emptyExpirationDatabase(factory: Pick<IDBFactory, "open">): Promise<MetadataClearing> {
  return new Promise((resolve, reject) => {
    // Without a version: opens whatever version Serwist created, whichever it is.
    const request = factory.open(EXPIRATION_DB_NAME);
    let absent = false;

    request.onupgradeneeded = () => {
      // Only a database that does not exist is "upgraded" from nothing: there is nothing to clear. Aborting the upgrade
      // stops the open from creating an empty database that was never there.
      absent = true;
      request.transaction?.abort();
    };
    request.onerror = () => {
      if (absent) resolve("absent");
      else reject(request.error ?? new Error(`Opening the ${EXPIRATION_DB_NAME} database failed.`));
    };
    request.onsuccess = () => {
      const database = request.result;
      const stores = Array.from(database.objectStoreNames);
      if (stores.length === 0) {
        database.close();
        resolve("cleared");
        return;
      }
      try {
        const transaction = database.transaction(stores, "readwrite");
        for (const store of stores) transaction.objectStore(store).clear();
        transaction.oncomplete = () => {
          database.close();
          resolve("cleared");
        };
        const failed = () => {
          database.close();
          reject(transaction.error ?? new Error(`Clearing the ${EXPIRATION_DB_NAME} database failed.`));
        };
        transaction.onerror = failed;
        transaction.onabort = failed;
      } catch (error) {
        database.close();
        reject(error instanceof Error ? error : new Error(`Clearing the ${EXPIRATION_DB_NAME} database failed.`));
      }
    };
  });
}

/**
 * Empties Serwist's expiration database, so that the URLs and times of everything the service worker cached go with
 * the profile (call it with `clearDeviceCaches`). It clears the rows and does not delete the database, on purpose:
 *
 * - Serwist's worker opens the database when it first caches a response and never closes the connection, and passes no
 *   `blocking` handler. While the worker runs, `deleteDatabase` from the page fires `blocked` and finishes only when
 *   the browser stops the worker: a deletion that cannot be confirmed when the worker is asked to forget, and a request
 *   left in the queue that holds up the worker's next `open`. Clearing the rows needs no cooperation from the worker
 *   and completes when its transaction does.
 * - Serwist's own `ExpirationPlugin.deleteCacheAndMetadata()` calls `CacheExpiration.delete()`, which only expires the
 *   rows of its one cache (`expireEntries(Infinity)`); it reaches no cache of `defaultCache`, whose plugin instances are
 *   not ours to call. Clearing every object store covers them all.
 *
 * It resolves only when the clearing has been committed. A failed attempt is tried once more; the second failure is
 * thrown, for the reason given at `clearApiCaches`. Where IndexedDB does not exist there is nothing to clear.
 */
export async function clearExpirationMetadata(
  factory: Pick<IDBFactory, "open"> | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
): Promise<MetadataClearing> {
  if (factory === undefined) return "absent";
  try {
    return await emptyExpirationDatabase(factory);
  } catch {
    return await emptyExpirationDatabase(factory);
  }
}

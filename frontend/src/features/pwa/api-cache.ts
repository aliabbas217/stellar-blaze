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
 * The IndexedDB database in which Serwist's `ExpirationPlugin` records, for every cache it expires (the API cache, each of
 * `DOCUMENT_CACHE_NAMES`, and the static asset caches), the URL and the fetch time of each cached entry (serwist 9.5.13,
 * `CacheTimestampsModel`: database `DB_NAME`, object store `CACHE_OBJECT_STORE`, index "cacheName"). Those URLs name the
 * sites a worker looked at. `clearDeviceCaches` does not touch it. tests/unit/features/pwa/api-cache.test.ts reads the
 * installed Serwist's source and fails if any of the three names changes.
 */
export const EXPIRATION_DB_NAME = "serwist-expiration";
const EXPIRATION_STORE = "cache-entries";
const EXPIRATION_INDEX = "cacheName";

/** "cleared": the rows are gone. "absent": there was no such database (or no IndexedDB), so there was nothing to clear. */
export type MetadataClearing = "cleared" | "absent";

/** An Error for whatever was thrown, keeping its message (a DOMException from another realm is not `instanceof Error`). */
function asError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  const message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : fallback;
  return new Error(message, { cause: error });
}

/**
 * Opens the expiration database at whatever version Serwist made it, or resolves null when there is none. Only a database
 * that does not exist is "upgraded" from nothing; aborting that stops the open from creating an empty one that was never
 * there.
 */
function openExpirationDatabase(factory: Pick<IDBFactory, "open">): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = factory.open(EXPIRATION_DB_NAME);
    let absent = false;
    request.onupgradeneeded = () => {
      absent = true;
      request.transaction?.abort();
    };
    request.onerror = () => {
      if (absent) resolve(null);
      else reject(request.error ?? new Error(`Opening the ${EXPIRATION_DB_NAME} database failed.`));
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

/**
 * Throws unless the database is shaped the way Serwist 9.5.13 makes it (a "cache-entries" store with a "cacheName"
 * index): a changed Serwist is reported, not guessed at, because a revoke that cleared the wrong thing must not say it
 * cleared the right one.
 */
function expirationStore(database: IDBDatabase): void {
  if (!Array.from(database.objectStoreNames).includes(EXPIRATION_STORE)) {
    throw new Error(`The ${EXPIRATION_DB_NAME} database has no "${EXPIRATION_STORE}" store: Serwist changed, and this must be revisited.`);
  }
}

function expirationIndex(transaction: IDBTransaction): IDBIndex {
  try {
    return transaction.objectStore(EXPIRATION_STORE).index(EXPIRATION_INDEX);
  } catch (error) {
    throw new Error(`The "${EXPIRATION_STORE}" store has no "${EXPIRATION_INDEX}" index: Serwist changed, and this must be revisited.`, { cause: error });
  }
}

/** One attempt at deleting, in one write transaction, the rows of every cache `DEVICE_CACHE_NAMES` names. */
async function deleteDeviceRows(factory: Pick<IDBFactory, "open">): Promise<MetadataClearing> {
  const database = await openExpirationDatabase(factory);
  if (database === null) return "absent";
  return await new Promise<MetadataClearing>((resolve, reject) => {
    try {
      if (database.objectStoreNames.length === 0) {
        database.close();
        resolve("cleared");
        return;
      }
      expirationStore(database);
      // Strict: the browser reports completion only after the data is on disk, not when it is queued.
      const transaction = database.transaction(EXPIRATION_STORE, "readwrite", { durability: "strict" });
      const index = expirationIndex(transaction);
      const store = transaction.objectStore(EXPIRATION_STORE);
      for (const name of DEVICE_CACHE_NAMES) {
        const cursor = index.openKeyCursor(name);
        cursor.onsuccess = () => {
          if (cursor.result === null) return;
          store.delete(cursor.result.primaryKey);
          cursor.result.continue();
        };
      }
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
      reject(asError(error, `Clearing the ${EXPIRATION_DB_NAME} database failed.`));
    }
  });
}

/**
 * Deletes what Serwist recorded about the caches a revoke clears (`DEVICE_CACHE_NAMES`): their entries' URLs and times. It
 * deletes those rows, by the "cacheName" index, and neither the other caches' rows nor the database, on purpose:
 *
 * - Serwist's worker opens the database when it first caches a response and never closes the connection, and passes no
 *   `blocking` handler. While the worker runs, `deleteDatabase` from the page fires `blocked` and finishes only when
 *   the browser stops the worker: a deletion that cannot be confirmed when the worker is asked to forget, and a request
 *   left in the queue that holds up the worker's next `open`. Deleting rows needs no cooperation from the worker and
 *   completes when its transaction does.
 * - Serwist's own `ExpirationPlugin.deleteCacheAndMetadata()` calls `CacheExpiration.delete()`, which only expires the
 *   rows of its one cache (`expireEntries(Infinity)`); it reaches no cache of `defaultCache`, whose plugin instances are
 *   not ours to call.
 * - The static asset caches survive a revoke (they hold no URL that names a site), and so must their rows: without them
 *   the entries of those caches would never expire.
 *
 * It resolves only when the deletion has been committed. A failed attempt is tried once more; the second failure is
 * thrown, for the reason given at `clearApiCaches`. Where IndexedDB does not exist there is nothing to clear.
 */
export async function clearExpirationMetadata(
  factory: Pick<IDBFactory, "open"> | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
): Promise<MetadataClearing> {
  if (factory === undefined) return "absent";
  try {
    return await deleteDeviceRows(factory);
  } catch {
    return await deleteDeviceRows(factory);
  }
}

/** How many rows of the expiration database belong to a cache `DEVICE_CACHE_NAMES` names. Rejects when it cannot be read. */
async function countDeviceRows(factory: Pick<IDBFactory, "open">): Promise<number> {
  const database = await openExpirationDatabase(factory);
  if (database === null) return 0;
  try {
    if (database.objectStoreNames.length === 0) return 0;
    expirationStore(database);
    const transaction = database.transaction(EXPIRATION_STORE, "readonly");
    const index = expirationIndex(transaction);
    const counts = DEVICE_CACHE_NAMES.map(
      (name) =>
        new Promise<number>((resolve, reject) => {
          const request = index.count(name);
          request.onsuccess = () => {
            resolve(request.result);
          };
          request.onerror = () => {
            reject(request.error ?? new Error(`Counting the ${EXPIRATION_DB_NAME} rows failed.`));
          };
        }),
    );
    return (await Promise.all(counts)).reduce((total, count) => total + count, 0);
  } finally {
    database.close();
  }
}

/**
 * Whether anything a revoke clears is on the phone: a cache of `DEVICE_CACHE_NAMES`, or an expiration row of one. It is
 * how a clearing is checked afterwards. A response the worker was still fetching when the clearing ran is written
 * after it, and re-creates the cache and its row (ruling R36); asking again finds that. Rejects when it cannot tell, which
 * is not an all-clear.
 *
 * KNOWN LIMIT (ruling R38): it looks once, straight after the clearing, with no settling delay. A response that reaches
 * Cache Storage after that look is not caught. That is accepted: no delay can promise an empty Cache Storage while the app
 * is open, because the worker caches the page the worker is looking at, again, by design. See `clearDeviceData` in the
 * profile store.
 */
export async function deviceDataRemains(
  storage: Pick<CacheStorage, "keys"> | undefined = typeof caches === "undefined" ? undefined : caches,
  factory: Pick<IDBFactory, "open"> | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
): Promise<boolean> {
  if (storage !== undefined) {
    const present = await storage.keys();
    if (present.some((name) => DEVICE_CACHE_NAMES.includes(name))) return true;
  }
  if (factory === undefined) return false;
  return (await countDeviceRows(factory)) > 0;
}

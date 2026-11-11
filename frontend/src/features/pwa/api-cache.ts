/*
 * What the service worker may keep of the API on the device, and how to remove it. Pure on purpose (no Serwist, no
 * DOM at import time): it is unit tested, bundled into the service worker, and imported by app code that must
 * clear the cache (Task 8's profile store).
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

/**
 * Deletes every cache that can hold an API response. Call it from the page when a worker takes consent back or
 * changes their profile (Task 8 wires that), so what the worker's phone remembers of the API goes with the
 * profile. It only touches the API caches: pages and the precache stay, so the app still opens offline.
 *
 * Every deletion is attempted; if any fails the returned promise rejects with the first failure, because a caller
 * that is withdrawing consent must not report success while data may remain. Where Cache Storage does not exist
 * (a page that is not a secure context, or no browser) there is nothing to delete and it resolves.
 */
export async function clearApiCaches(
  storage: Pick<CacheStorage, "delete"> | undefined = typeof caches === "undefined" ? undefined : caches,
): Promise<void> {
  if (storage === undefined) return;
  const results = await Promise.allSettled(API_CACHE_NAMES.map((name) => storage.delete(name)));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed !== undefined) throw failed.reason;
}

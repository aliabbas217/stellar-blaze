/*
 * The two API responses the service worker keeps for offline use (docs ADR 0010): today's forecast of a site and
 * the risk policy. The worker app needs both to show a level offline; every other /api/v1 call stays on the
 * default rules. Pure on purpose (unit tested, bundled into the service worker).
 *
 * The values are the cache's own tuning, not risk parameters: those come from the API, never from here.
 */

/** Name of the Cache Storage cache that holds them. */
export const API_CACHE_NAME = "sb-api";

/** The network gets this long before the cached copy is used (a flaky mobile connection, not only no connection). */
export const API_CACHE_NETWORK_TIMEOUT_SECONDS = 4;

/** A cached copy older than this is dropped: two days covers a shift without signal, no more. */
export const API_CACHE_MAX_AGE_SECONDS = 48 * 60 * 60;

/** One forecast per site the worker looked at, and the policy. */
export const API_CACHE_MAX_ENTRIES = 20;

// One path segment for the site id: `a/b` or an empty id is not a site.
const FORECAST_TODAY = /^\/api\/v1\/sites\/[^/]+\/forecast\/today$/;
const RISK_POLICY = "/api/v1/risk-policy";

/** Whether this same-origin path is one of the two responses kept for offline use. Query strings are not part of a pathname. */
export function isCachedApiPath(pathname: string): boolean {
  return pathname === RISK_POLICY || FORECAST_TODAY.test(pathname);
}

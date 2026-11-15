/*
 * Which site the Alerts screen subscribes for, until Task 8's on-device profile holds the worker's site: the `?site=`
 * query, and nothing else. `?debug=push` is the real-phone spike's switch (the subscription JSON, Copy and Share).
 *
 * Task 8 replaces `siteIdFromSearch` with the profile's `siteId`; the debug default below goes with it.
 */

export type SearchValue = string | string[] | undefined;

/**
 * The first fixture site (SITE_DEMO in src/mocks/fixtures.ts; tests/unit/features/push/site.test.ts pins that they
 * agree). Used ONLY with `?debug=push` and no `?site=`, so the spike on a phone can subscribe without a profile. Without
 * the debug switch a missing site stays missing, and the screen says so.
 */
export const DEBUG_DEFAULT_SITE_ID = "site-demo-mussafah";

function first(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** True for `?debug=push`. */
export function isPushDebug(debug: SearchValue): boolean {
  return first(debug) === "push";
}

/** The site id from `?site=` (trimmed), else the debug default when debugging, else null. */
export function siteIdFromSearch(params: { readonly site?: SearchValue; readonly debug?: SearchValue }): string | null {
  const site = first(params.site)?.trim();
  if (site !== undefined && site !== "") return site;
  return isPushDebug(params.debug) ? DEBUG_DEFAULT_SITE_ID : null;
}

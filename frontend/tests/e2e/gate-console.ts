/*
 * The rules `watchConsole` (gate.ts) applies to what the browser reports, kept free of Playwright so a unit test can pin them
 * (tests/unit/e2e/gate-console.test.ts). The page can fail in three ways the console alone does not reveal:
 *   - an HTTP error response (status 400 and up): the console line for it carries no URL, so the response is reported instead;
 *   - a request that never got a response (DNS, reset, blocked by CSP, aborted): no `response` event fires for it, only
 *     `requestfailed`, and the console line is the same URL-less "Failed to load resource";
 *   - an uncaught exception or a console error.
 */

/**
 * Core views that are planned but not built yet, and are already linked from the shared desk menu (the judge layout, F2 Task 3).
 * The browser prefetches menu links, so a missing view logs a 404 on every judge page until it lands. Those 404s, and ONLY
 * 404s, are ignored by path: a 500 on one of them, or any other failed request, is still an error. REMOVE an entry in the same
 * change that builds its view.
 */
export const UNBUILT_CORE_ROUTES: readonly string[] = [];

/** The path of a URL without its locale prefix ("/en/replay/day" is "/replay/day"). */
export function routePath(url: string): string {
  return new URL(url).pathname.replace(/^\/[a-z]{2}(?=\/)/, "");
}

/** The console line for a failed resource carries no URL: `responseError` and `requestFailure` report it with one instead. */
export function isUrllessResourceLine(text: string): boolean {
  return text.startsWith("Failed to load resource");
}

/** The error to record for a response, or null when it is fine (below 400) or is the 404 of a route that is not built yet. */
export function responseError(status: number, url: string): string | null {
  if (status < 400) return null;
  if (status === 404 && UNBUILT_CORE_ROUTES.includes(routePath(url))) return null;
  return `HTTP ${String(status)} ${url}`;
}

/**
 * The error to record for a request that failed before any response (a network-layer failure), or null for one the page
 * cancelled itself: navigating away aborts the requests still in flight (`net::ERR_ABORTED`: prefetches, RSC payloads), and
 * that is not a failure of the page. Everything else (reset, DNS, refused, blocked by CSP, timed out) is.
 */
export function requestFailure(url: string, failureText: string | null | undefined): string | null {
  if (failureText === "net::ERR_ABORTED") return null;
  return `request failed ${url}${failureText === null || failureText === undefined || failureText === "" ? "" : ` (${failureText})`}`;
}

/**
 * A hydration message, whatever its console type: React's production codes for a text, an attribute, a missing-parent or a
 * tree mismatch (#418, #419, #422, #423, #425; #419 is the whole-root client re-render) and the development wording.
 * The console collector records these in every type, so a build that logs one as `log` or `warning` still fails the gate.
 */
const HYDRATION = /Minified React error #(?:418|419|422|423|425)\b|hydrat(?:ion|ed|e)\b[^\n]*|did not match|didn't match/i;

export function isHydrationText(text: string): boolean {
  return HYDRATION.test(text) && !/^Download the React DevTools/i.test(text);
}

/**
 * What to record for one console message, or null. A console error is recorded (but not the URL-less "Failed to load resource"
 * line, which `responseError` and `requestFailure` report with its URL); a warning only when `warnings` is true, marked as one;
 * a hydration message in ANY type always.
 */
export function consoleLineToRecord(type: string, text: string, warnings: boolean): string | null {
  if (type === "error" && !isUrllessResourceLine(text)) return text;
  if (isHydrationText(text)) return text;
  if (warnings && type === "warning") return `warning: ${text}`;
  return null;
}

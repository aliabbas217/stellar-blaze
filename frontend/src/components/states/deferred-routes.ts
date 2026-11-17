import { routing } from "@/i18n/routing";

/**
 * Views that are parked, not built (ADR 0045 as amended: the core views are ten). An empty state must never send a
 * person to one of them: a dead end dressed as a next step. Paths are written without the locale prefix.
 *
 * These are guesses at the URLs the parked views will have, taken from the parking-lot rows of the F2 plan (HSE week,
 * site setup, roster import, crew codes and join, relay, config admin, Listen, climate what-if, break-things panel,
 * next steps). The judge views live under `/replay` ((judge) is a route group with no URL segment). None of them
 * exists in src/app yet. (`/hse` left this list in redesign S7: the minimal safety view is built; the parked HSE WEEK view it once stood for is
 * still a separate, unbuilt page.)
 * RE-CHECK each entry when its view is built: the same change must take it out of this list (the unit test fails if a
 * guarded path becomes a real route).
 *
 * Not here on purpose: `/worker/alerts`, a built F1 route that Today's primary action goes to.
 */
export const DEFERRED_ROUTES = [
  "/admin",
  "/supervisor/setup",
  "/supervisor/roster",
  "/supervisor/qr",
  "/supervisor/relay",
  "/worker/join",
  "/worker/listen",
  "/replay/climate",
  "/replay/faults",
  "/replay/next",
] as const;

/** The path of an href: no query, no hash, no locale prefix. */
function barePath(href: string): string {
  const path = href.split(/[?#]/, 1)[0] ?? "";
  const [, first = "", ...rest] = path.split("/");
  return (routing.locales as readonly string[]).includes(first) ? `/${rest.join("/")}` : path;
}

/** True when the href is a deferred route or lives under one ("/ur/hse", "/en/supervisor/roster?x=1"). */
export function isDeferredRoute(href: string): boolean {
  const path = barePath(href);
  return DEFERRED_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
}

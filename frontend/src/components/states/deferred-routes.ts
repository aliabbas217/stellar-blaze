import { routing } from "@/i18n/routing";

/**
 * Views that are parked, not built (ADR 0045 as amended: the core views are ten). An empty state must never send a
 * person to one of them: a dead end dressed as a next step. Paths are written without the locale prefix.
 *
 * The list follows the deferred rows of the F2 plan (parking lot: HSE week, site setup, roster import, crew codes and
 * join, relay, config admin, climate what-if, break-things panel, Listen). Move a route out of here in the same change
 * that builds its view.
 */
export const DEFERRED_ROUTES = [
  "/hse",
  "/admin",
  "/supervisor/setup",
  "/supervisor/roster",
  "/supervisor/qr",
  "/supervisor/relay",
  "/worker/join",
  "/worker/listen",
  "/judge/climate",
  "/judge/faults",
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

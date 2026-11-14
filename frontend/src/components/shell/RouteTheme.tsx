"use client";

import { useRouteTheme } from "@/components/shell/useRouteTheme";

/**
 * Renders nothing; keeps `data-theme` and `<meta name="theme-color">` right for the route on every client navigation.
 * Mounted once in the [locale] layout so that sun mode can only ever show on a field path: without it, a visitor who
 * leaves a field route by a client-side link (the wordmark, a link to the landing page) would keep the sun theme on a
 * night-only page, because the inline script does not run again. The field and desk shells apply the same rule
 * themselves; this covers the pages that have no shell (landing, HSE, offline).
 */
export function RouteTheme() {
  useRouteTheme("route", { skipInitial: true });
  return null;
}

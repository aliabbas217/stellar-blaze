"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { applyRouteTheme, setTheme } from "@/lib/sun/route-theme";

/**
 * Applies the theme of the route the shell is on, on mount and on every route change. The inline script
 * (theme-script.ts) runs once per full page load, so after a client-side navigation between a desk route and a field
 * route nothing else would move `data-theme` or `<meta name="theme-color">`.
 *
 * - `"route"`: whatever the path calls for: sun mode as the script decides it (override, contrast, replay, sun) on a field
 *   path, night on anything else.
 * - `"desk"`: always night (judge, HSE and admin routes are night only), whatever a field route left behind.
 *
 * A page with neither shell (landing, offline) is covered by the field shell's unmount, which puts night back (FieldShell.tsx).
 *
 * The attribute on `<html>` is the one source of truth for what is showing; nothing renders from it (the settings sheet's
 * "Screen colors" reads the stored choice when it opens), so applying the theme needs no render.
 */
export function useRouteTheme(kind: "route" | "desk"): void {
  const pathname = usePathname();

  useEffect(() => {
    if (kind === "desk") setTheme("night");
    else void applyRouteTheme(pathname);
  }, [kind, pathname]);
}

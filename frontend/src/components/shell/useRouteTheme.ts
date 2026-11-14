"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
 * The attribute on `<html>` is the one source of truth, and SunToggle reads it during render. After each application the
 * shell is rendered again so the toggle (a child) reads the current value.
 */
export function useRouteTheme(kind: "route" | "desk"): void {
  const pathname = usePathname();
  const [, rerender] = useState(0);

  useEffect(() => {
    let current = true;
    const settled = kind === "desk" ? Promise.resolve(setTheme("night")) : applyRouteTheme(pathname);
    void settled.then(() => {
      // Always, not only when the attribute changed: on a full load the inline script set it before React hydrated, and a
      // child that rendered the server's "night" (SunToggle) must read the real value, which only a render does.
      if (current) rerender((count) => count + 1);
    });
    return () => {
      current = false;
    };
  }, [kind, pathname]);
}

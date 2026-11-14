"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { setTheme } from "@/lib/sun/route-theme";
import { nextLocalMidnight, THEME_STORAGE_KEY, type ThemeName, type ThemeOverride } from "@/lib/sun/theme-storage";

/*
 * The one tap that overrides sun mode until the next local midnight (DESIGN.md section 6). It owns the
 * `{ theme, until }` value in localStorage["sb-theme"]; the inline script (theme-script.ts) reads it before paint on
 * the next full load. The attribute on <html> is the source of truth for what is showing now: the script sets it
 * before hydration and this button flips it, so there is no second copy of the state to drift.
 */

const listeners = new Set<() => void>();

function readTheme(): ThemeName {
  return document.documentElement.dataset["theme"] === "sun" ? "sun" : "night";
}

function applyTheme(theme: ThemeName): void {
  // The attribute and EVERY theme-color meta, the same function the route changes use: a production document has two
  // (the layout's and the copy React hoists into <head>), and moving only the first left the other on the old colour.
  setTheme(theme);
  for (const notify of listeners) notify();
}

function persist(theme: ThemeName): void {
  const override: ThemeOverride = { theme, until: nextLocalMidnight(new Date()) };
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(override));
  } catch {
    // Storage can be blocked or full. The choice still applies for this visit; it just is not remembered.
  }
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** Flips between sun and night for the rest of the local day. */
export function SunToggle() {
  const t = useTranslations("shell.sun");
  const theme = useSyncExternalStore(subscribe, readTheme, (): ThemeName => "night");

  return (
    <button
      type="button"
      onClick={() => {
        const next: ThemeName = theme === "sun" ? "night" : "sun";
        persist(next);
        applyTheme(next);
      }}
      className="inline-flex min-h-(--target) min-w-(--target) touch-manipulation items-center justify-center rounded-sign border border-edge bg-ground px-4 font-body text-sm text-ink"
    >
      {t("current", { state: t(theme === "sun" ? "on" : "off") })}
    </button>
  );
}

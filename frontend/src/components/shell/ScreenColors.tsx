"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { CHIP } from "@/components/states/actions";
import { applyRouteTheme, setTheme } from "@/lib/sun/route-theme";
import { nextLocalMidnight, THEME_STORAGE_KEY, type ThemeName, type ThemeOverride } from "@/lib/sun/theme-storage";

/*
 * "Screen colors": Automatic, Bright or Night (redesign S5; it replaces the header's "Sun mode: on" button). Automatic is what the
 * app always did: the sun decides (route-theme.ts). Bright and Night are the one-tap override of DESIGN.md section 6, kept until the
 * next local midnight in localStorage["sb-theme"] as `{ theme, until }`; the inline script (theme-script.ts) reads it before paint on
 * the next full load, so the choice survives a reload. Automatic removes the override. The attribute on <html> stays the one source of
 * truth for what is showing; this control only holds which of the three the worker asked for, and reads it when it is mounted (the
 * sheet mounts it on open), so there is nothing to hydrate and no second copy of the state to drift.
 */

export type ScreenColorsMode = "auto" | "bright" | "night";

/** What the phone has asked for: the unexpired stored override, else Automatic. */
export function readScreenColors(): ScreenColorsMode {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) ?? "null");
    if (typeof value === "object" && value !== null) {
      const { theme, until } = value as Record<string, unknown>;
      if ((theme === "sun" || theme === "night") && typeof until === "number" && until > Date.now()) return theme === "sun" ? "bright" : "night";
    }
  } catch {
    // Blocked or not JSON: no override, so Automatic.
  }
  return "auto";
}

function persist(theme: ThemeName | null): void {
  try {
    if (theme === null) window.localStorage.removeItem(THEME_STORAGE_KEY);
    else {
      const override: ThemeOverride = { theme, until: nextLocalMidnight(new Date()) };
      window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(override));
    }
  } catch {
    // Storage can be blocked or full. The choice still applies for this visit; it just is not remembered.
  }
}

const OPTIONS = [
  { mode: "auto", key: "auto" },
  { mode: "bright", key: "bright" },
  { mode: "night", key: "night" },
] as const satisfies readonly { mode: ScreenColorsMode; key: string }[];

export function ScreenColors() {
  const t = useTranslations("shell.settings.colors");
  const [mode, setMode] = useState<ScreenColorsMode>(readScreenColors);

  function choose(next: ScreenColorsMode): void {
    setMode(next);
    if (next === "auto") {
      persist(null);
      // The sun decides again, on the route the phone is on (it needs the pathname's locale prefix, as the shells pass it).
      void applyRouteTheme(window.location.pathname);
      return;
    }
    const theme: ThemeName = next === "bright" ? "sun" : "night";
    persist(theme);
    // The attribute and EVERY theme-color meta, the same function the route changes use.
    setTheme(theme);
  }

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 text-base leading-(--sign-leading-text) font-medium text-ink-3">{t("label")}</legend>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map(({ mode: option, key }) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            data-screen-colors={option}
            onClick={() => {
              choose(option);
            }}
            className={`${CHIP} px-4 text-base`}
          >
            {t(key)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

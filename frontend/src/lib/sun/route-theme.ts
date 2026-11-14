import { THEME_COLORS } from "@/lib/sun/theme-colors";
import { DEMO_STORAGE_KEY, THEME_STORAGE_KEY, type ThemeName, type ThemeOverride } from "@/lib/sun/theme-storage";

/*
 * The theme of a route, applied from the client. The inline script (src/components/shell/theme-script.ts) decides it
 * before first paint, once per full page load; a client-side navigation between a desk route and a field route does
 * not re-run it, so the shells (FieldShell, DeskShell) call this on every route change.
 *
 * This is a second implementation of the script's decision. tests/unit/lib/sun/route-theme.test.ts runs both over the
 * same inputs (storage, contrast preference, demo mode, time of day) and fails if they ever disagree.
 *
 * Only keys and types come from theme-storage.ts; the solar function is loaded on demand, in live mode only, so replay
 * (the default) never downloads it.
 */

/** The field paths: `/<locale>/worker` and `/<locale>/supervisor` with anything below. Mirrors the script's FIELD_PATH. */
const FIELD_PATH = /^\/[a-z]{2}\/(?:worker|supervisor)(?:\/|$)/;

export function isFieldPath(pathname: string): boolean {
  return FIELD_PATH.test(pathname);
}

export interface ThemeInput {
  /** The stored sun override, or null when there is none (or it was unreadable). */
  readonly override: ThemeOverride | null;
  readonly contrastMore: boolean;
  readonly demo: "live" | "replay";
  readonly nowMs: number;
}

/**
 * The decision, in the script's order: an unexpired override, then `prefers-contrast: more`, then replay mode (daytime
 * by construction), then the sun. `"solar"` means only the sun can answer: the caller supplies the elevation.
 */
export function decideTheme(input: ThemeInput): ThemeName | "solar" {
  const { override, contrastMore, demo, nowMs } = input;
  if (override !== null && override.until > nowMs) return override.theme;
  if (contrastMore) return "sun";
  if (demo !== "live") return "sun";
  return "solar";
}

/** The theme showing now: what `<html data-theme>` says, the one source of truth (SunToggle reads the same attribute). */
export function currentTheme(): ThemeName {
  return document.documentElement.dataset["theme"] === "sun" ? "sun" : "night";
}

/** Sets `data-theme` and the browser chrome colour; true when the theme changed. Night is the absence of the attribute. */
export function setTheme(theme: ThemeName): boolean {
  const html = document.documentElement;
  const changed = currentTheme() !== theme;
  if (theme === "sun") html.dataset["theme"] = "sun";
  else delete html.dataset["theme"];
  // Every theme-color meta, not the first only: Next renders the viewport one and React can hoist a second into <head>.
  for (const meta of document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.setAttribute("content", THEME_COLORS[theme]);
  }
  return changed;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readOverride(): ThemeOverride | null {
  try {
    const value: unknown = JSON.parse(read(THEME_STORAGE_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    const { theme, until } = value as Record<string, unknown>;
    if ((theme === "sun" || theme === "night") && typeof until === "number") return { theme, until };
  } catch {
    // Not JSON: no override.
  }
  return null;
}

/**
 * What this device shows on `pathname`: night on anything that is not a field path, otherwise the decision above. Applies
 * it and resolves the theme applied. The browser's own settings are read here, so it is for the client only.
 */
export async function applyRouteTheme(pathname: string): Promise<ThemeName> {
  const decision: ThemeName | "solar" = isFieldPath(pathname)
    ? decideTheme({
        override: readOverride(),
        contrastMore: typeof window.matchMedia === "function" && window.matchMedia("(prefers-contrast: more)").matches,
        demo: read(DEMO_STORAGE_KEY) === "live" ? "live" : "replay",
        nowMs: Date.now(),
      })
    : "night";
  let theme: ThemeName;
  if (decision === "solar") {
    const { solarElevationDeg, UAE_CENTROID } = await import("@/lib/sun/solar");
    // The import takes time, and the visitor can leave the field route inside that window (field to desk). The desk shell
    // has already put night on <html>; applying the sun now would leave it on a night-only judge page. The caller that
    // changed the route owns the theme from here, so this one reports what is showing and writes nothing.
    if (!isFieldPath(window.location.pathname)) return currentTheme();
    theme = solarElevationDeg(UAE_CENTROID.lat, UAE_CENTROID.lon, new Date()) > 0 ? "sun" : "night";
  } else {
    theme = decision;
  }
  setTheme(theme);
  return theme;
}

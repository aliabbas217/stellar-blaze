/*
 * What sun mode keeps in localStorage. Deliberately a tiny module with no side effects and no imports: client code
 * (ScreenColors, Task 3's DemoProvider) imports from here and never from src/components/shell/theme-script.ts, whose
 * module-level `sunScript` string embeds the solar function and would ship in every client chunk that imported it.
 */

/** localStorage key of the sun override: JSON `{ theme: "sun" | "night", until: epoch ms }`, written by ScreenColors (Bright or Night; Automatic removes it). */
export const THEME_STORAGE_KEY = "sb-theme";

/**
 * localStorage key of the demo mode (`"replay"` or `"live"`). Task 3's DemoProvider owns it; the inline script only
 * reads it. Absent means replay, the default.
 */
export const DEMO_STORAGE_KEY = "sb-demo";

export type ThemeName = "sun" | "night";

/** What ScreenColors stores: the chosen theme and the instant it stops applying (the next local midnight). */
export interface ThemeOverride {
  readonly theme: ThemeName;
  readonly until: number;
}

/** The first instant of the next local day: an override lasts "until the next local midnight" (DESIGN.md section 6). */
export function nextLocalMidnight(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
}

/** localStorage key of the theme override. Absent means "follow the system". */
export const THEME_STORAGE_KEY = "sb-theme";

export type ThemeChoice = "system" | "light" | "dark";

/**
 * Inline script for `<head>`, run before first paint so a stored override never flashes the wrong
 * theme. It only ever sets data-theme to "light" or "dark"; with no override the CSS system default
 * applies (tokens.css swaps on prefers-color-scheme when data-theme is not "light"). Storage can throw
 * (private windows, blocked site data), so the read is wrapped and a failure leaves the system default.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}})()`;

/**
 * The `--ground` colour of each theme as sRGB hex: the colour of the browser chrome (<meta name="theme-color">) and of
 * the web app manifest, which cannot hold oklch(). Night is the default; sun applies on the field routes while sun mode
 * is on. tests/unit/app/manifest.test.ts recomputes both from src/styles/tokens.css and fails if either drifts.
 *
 * It lives in src/lib because the theme script and the screen-colors control (src/components) need it too, and shared code must
 * not import a feature (eslint.config.mjs, route-group isolation).
 */
export const THEME_COLORS = { night: "#0a1015", sun: "#f9fafb" } as const;

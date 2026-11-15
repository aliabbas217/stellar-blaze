import type { MetadataRoute } from "next";
import { THEME_COLORS } from "@/lib/sun/theme-colors";
import { dirFor } from "@/i18n/direction";
import type { Locale } from "@/i18n/routing";

/*
 * The web app manifest of one locale, served at /<locale>/manifest.webmanifest.
 *
 * It is per locale, not one file, because start_url must carry the locale: an Urdu worker who installs the
 * app from /ur must open it on /ur/worker, never /en/worker (docs review focus 2). `id` is the same for every
 * locale on purpose: the six manifests describe one app, so installing from another language updates it
 * instead of adding a second icon.
 */

/**
 * Colours of the manifest and of the browser chrome (<meta name="theme-color">), as sRGB hex: a manifest cannot
 * hold oklch(). They are the `--ground` token of each theme (night and sun in src/styles/tokens.css), kept in
 * src/lib/sun/theme-colors.ts so the theme script and the sun toggle can use them too;
 * tests/unit/app/manifest.test.ts recomputes them from tokens.css and fails if either drifts. The installed app is
 * night: the manifest has one theme_color and night is the default.
 */
export const MANIFEST_COLORS = THEME_COLORS;

/** The only message keys the manifest reads, from the `common` namespace. */
export type ManifestTranslator = (key: "appName" | "appDescription") => string;

/*
 * Icons are the amber water drop (src/components/level/pictograms.tsx) on sand-50, full-bleed: F1 artwork, still to
 * be redrawn for Qaylula (parked in the Task 1 report). The maskable one keeps the drop inside the central 80%
 * circle that Android crops to. The three files keep their names and sizes when the artwork is replaced.
 */
const ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
] as const satisfies NonNullable<MetadataRoute.Manifest["icons"]>;

/**
 * The apple-touch-icon: the 192 icon. Safari reads manifest icons only since iOS 15.4 and still prefers a
 * <link rel="apple-touch-icon">, and a page without either gets a screenshot tile. iOS scales it to its own size
 * and rounds the corners itself, which is why the artwork is a full-bleed square.
 */
export const APPLE_TOUCH_ICON = { url: ICONS[0].src, sizes: ICONS[0].sizes, type: ICONS[0].type };

export function manifestFor(locale: Locale, t: ManifestTranslator): MetadataRoute.Manifest {
  return {
    id: "/worker",
    name: t("appName"),
    // The brand name has no shorter form; a launcher wraps or truncates it itself.
    short_name: t("appName"),
    description: t("appDescription"),
    lang: locale,
    dir: dirFor(locale),
    start_url: `/${locale}/worker?source=pwa`,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: MANIFEST_COLORS.night,
    background_color: MANIFEST_COLORS.night,
    icons: [...ICONS],
  };
}

import type { MetadataRoute } from "next";
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
 * hold oklch(). They are the `--surface` token of each theme (sand-50 and sand-950 in src/styles/tokens.css);
 * tests/unit/app/manifest.test.ts recomputes them from tokens.css and fails if either drifts.
 */
export const MANIFEST_COLORS = { light: "#fbf6ee", dark: "#140e09" } as const;

/** The only message keys the manifest reads, from the `common` namespace. */
export type ManifestTranslator = (key: "appName" | "appDescription") => string;

/*
 * Icons are the amber water drop (src/components/level/pictograms.tsx) on sand-50, full-bleed. The maskable one
 * keeps the drop inside the central 80% circle that Android crops to. The design phase may replace the artwork;
 * the three files keep their names and sizes.
 */
const ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
] as const satisfies NonNullable<MetadataRoute.Manifest["icons"]>;

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
    theme_color: MANIFEST_COLORS.light,
    background_color: MANIFEST_COLORS.light,
    icons: [...ICONS],
  };
}

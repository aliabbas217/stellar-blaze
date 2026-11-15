import { createSerwistRoute } from "@serwist/turbopack";
import { PRECACHE_URLS } from "@/features/pwa/fallback";

/*
 * Builds src/app/sw.ts with esbuild at `next build` and serves it at /serwist/sw.js (Serwist's Turbopack setup:
 * https://serwist.pages.dev/docs/next/turbo). The route is static, so nothing here runs in the container.
 *
 *  - Scope: the handler sends `Service-Worker-Allowed: /` and SerwistProvider registers with scope "/", so the
 *    worker controls /<locale>/worker and not just /serwist/. tests/e2e/pwa.spec.ts pins it.
 *  - Precache: next to the build's static files, one offline page, one unwell call sheet and one alert-card shell per locale
 *    (the sheet is a safety action and must open with no signal; a warning is tapped with the app closed, possibly offline), so
 *    all are on the device before the first offline request. The revision changes with every build (APP_VERSION when the build
 *    has one, else a random id), so a deploy refreshes the cached pages. An empty APP_VERSION counts as unset:
 *    an empty revision would make Serwist treat the page as never changing.
 *  - useNativeEsbuild: Serwist defaults to esbuild-wasm off Windows; the native esbuild is the installed one.
 */

const revision = process.env.APP_VERSION || crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  additionalPrecacheEntries: PRECACHE_URLS.map((url) => ({ url, revision })),
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
});

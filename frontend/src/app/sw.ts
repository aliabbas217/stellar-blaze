import { defaultCache } from "@serwist/turbopack/worker";
import {
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
  type PrecacheEntry,
  type RuntimeCaching,
  type SerwistGlobalConfig,
} from "serwist";
import {
  API_CACHE_MAX_AGE_SECONDS,
  API_CACHE_MAX_ENTRIES,
  API_CACHE_NAME,
  API_CACHE_NETWORK_TIMEOUT_SECONDS,
  isCachedApiPath,
} from "@/features/pwa/api-cache";
import { offlineFallbacks } from "@/features/pwa/fallback";

/*
 * The service worker, bundled by esbuild at build time (src/app/serwist/[path]/route.ts) and served at /serwist/sw.js.
 * It has no DOM: the types come from the "webworker" lib in tsconfig.json, and `self` is narrowed below.
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Replaced at build time with the precache manifest (Serwist's default injection point).
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// The two API responses kept for offline use (ADR 0010: the forecast and the policy that goes with it). Network
// first, so a connected worker always gets fresh levels; a slow or absent network falls back to the last copy.
// Registered before defaultCache, whose `/api/` rule would otherwise answer these first.
const offlineApi: RuntimeCaching = {
  matcher: ({ sameOrigin, url }) => sameOrigin && isCachedApiPath(url.pathname),
  method: "GET",
  handler: new NetworkFirst({
    cacheName: API_CACHE_NAME,
    networkTimeoutSeconds: API_CACHE_NETWORK_TIMEOUT_SECONDS,
    plugins: [new ExpirationPlugin({ maxEntries: API_CACHE_MAX_ENTRIES, maxAgeSeconds: API_CACHE_MAX_AGE_SECONDS })],
  }),
};

const serwist = new Serwist({
  // undefined in development, where Serwist does not build a precache manifest.
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [offlineApi, ...defaultCache],
  // One precached page per locale, chosen by the path's locale: an Urdu worker offline reads Urdu.
  fallbacks: { entries: offlineFallbacks() },
});

serwist.addEventListeners();

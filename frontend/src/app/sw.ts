import { defaultCache } from "@serwist/turbopack/worker";
import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";
import { offlineFallbacks } from "@/features/pwa/fallback";
import { runtimeCachingWith } from "@/features/pwa/runtime-caching";

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

const serwist = new Serwist({
  // undefined in development, where Serwist does not build a precache manifest.
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // /api/ first (src/features/pwa/runtime-caching.ts): two allow-listed responses are kept, every other /api/ request
  // goes to the network and is never stored, ahead of defaultCache's own /api/ rule.
  // defaultCache's document and RSC rules stay: F1's pages are prerendered, carry no personal data and need no login,
  // so caching them is safe. Revisit them (and the precache) as soon as any page depends on who is looking at it.
  runtimeCaching: runtimeCachingWith(defaultCache),
  // One precached page per locale, chosen by the path's locale: an Urdu worker offline reads Urdu.
  fallbacks: { entries: offlineFallbacks() },
});

serwist.addEventListeners();

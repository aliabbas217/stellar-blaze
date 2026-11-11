import { defaultCache } from "@serwist/turbopack/worker";
import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";
import { offlineFallbacks } from "@/features/pwa/fallback";
import { readLocalePref } from "@/features/pwa/prefs";
import { runtimeCachingWith } from "@/features/pwa/runtime-caching";
import { openNotificationTarget, readPushData, showPushNotification } from "@/features/push/sw-handlers";

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

/*
 * Web Push (docs/contracts/web-push.md). The logic is in src/features/push/sw-handlers.ts, where it is unit tested; this
 * file only connects it to the worker. Push subscriptions are POST and DELETE requests made by the page, which the
 * runtime caching above has no route for: nothing about them is, or may ever be, added to its allow-list.
 *
 * A push whose payload is not exactly the contract's shows nothing and is not rethrown, as the contract says. The cost
 * to know: with userVisibleOnly, Chrome then shows a generic notice of its own, and WebKit revokes a subscription whose
 * pushes show nothing (https://webkit.org/blog/16535/meet-declarative-web-push/). Revisit if the API ever sends a
 * payload this worker cannot parse.
 */
self.addEventListener("push", (event) => {
  event.waitUntil(
    showPushNotification(readPushData(event), {
      readLocale: readLocalePref,
      show: (title, options) => self.registration.showNotification(title, options),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    openNotificationTarget(event.notification.data, {
      origin: self.location.origin,
      readLocale: readLocalePref,
      windows: () => self.clients.matchAll({ type: "window", includeUncontrolled: true }),
      openWindow: (url) => self.clients.openWindow(url),
    }),
  );
});

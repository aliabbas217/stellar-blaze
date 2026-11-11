import {
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  type FetchDidSucceedCallbackParam,
  type HandlerDidErrorCallbackParam,
  type PluginState,
  type RuntimeCaching,
  type SerwistPlugin,
} from "serwist";
import {
  API_CACHE_MAX_AGE_SECONDS,
  API_CACHE_MAX_ENTRIES,
  API_CACHE_NAME,
  API_CACHE_NETWORK_TIMEOUT_SECONDS,
  isCachedApiPath,
} from "@/features/pwa/api-cache";

/*
 * The service worker's rules for /api/. Bundled into the worker (src/app/sw.ts) and, because it is a plain
 * function of its input, resolved through Serwist's own router by tests/unit/features/pwa/runtime-caching.test.ts.
 */

// A 5xx is the server failing, not an answer: treat it like a lost connection, so NetworkFirst serves the cached
// copy. The BFF answers 502 when the API is down while the phone is online; without this the worker would show
// that error over a forecast it still holds. NetworkFirst only falls back to the cache on a thrown error, and
// Serwist plugin callbacks are the place to throw.
//
// If there is no cached copy, NetworkFirst throws "no-response", and the page must still get the error it came
// for (the problem+json body carries the request id the error screen shows), not an anonymous network failure.
// So the error response is kept for that request and handed back by handlerDidError.
const keptErrorResponses = new WeakMap<PluginState, Response>();

export const serverErrorFallsBackToCache = {
  fetchDidSucceed({ response, state }: FetchDidSucceedCallbackParam): Response {
    if (response.status < 500) return response;
    if (state !== undefined) keptErrorResponses.set(state, response);
    throw new Error(`The server answered ${String(response.status)}`);
  },
  handlerDidError({ state }: HandlerDidErrorCallbackParam): Response | undefined {
    return state === undefined ? undefined : keptErrorResponses.get(state);
  },
} satisfies SerwistPlugin;

/**
 * The rules for same-origin /api/ GET requests, in the order that matters (the first match wins):
 *  1. the allow-list (OFFLINE_API_ALLOW_LIST): NetworkFirst into the sb-api cache;
 *  2. every other /api/ request: NetworkOnly, so it is never stored.
 * Requests that are not GET have no route here at all, so they go straight to the network.
 */
function apiRuntimeCaching(): RuntimeCaching[] {
  return [
    {
      matcher: ({ sameOrigin, url }) => sameOrigin && isCachedApiPath(url.pathname),
      method: "GET",
      handler: new NetworkFirst({
        cacheName: API_CACHE_NAME,
        networkTimeoutSeconds: API_CACHE_NETWORK_TIMEOUT_SECONDS,
        plugins: [
          serverErrorFallsBackToCache,
          new ExpirationPlugin({ maxEntries: API_CACHE_MAX_ENTRIES, maxAgeSeconds: API_CACHE_MAX_AGE_SECONDS }),
        ],
      }),
    },
    {
      // Serwist's defaultCache has a same-origin /api/ rule of its own (cache "apis"), and a json/xml/csv rule that
      // would also take /api/v1/x.json. This rule is registered ahead of all of them, so none can match /api/.
      // It was chosen over filtering defaultCache because that would depend on the contents of a library list,
      // and a Serwist update could add a rule that silently caches API responses again.
      matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/api/"),
      method: "GET",
      handler: new NetworkOnly(),
    },
  ];
}

/** The worker's runtime caching: the /api/ rules first, then `defaults` (Serwist's defaultCache). */
export function runtimeCachingWith(defaults: readonly RuntimeCaching[]): RuntimeCaching[] {
  return [...apiRuntimeCaching(), ...defaults];
}

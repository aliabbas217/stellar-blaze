// @vitest-environment node
import { defaultCache as productionDefaults } from "@serwist/turbopack/worker";
import {
  NetworkFirst,
  NetworkOnly,
  Serwist,
  type PluginState,
  type RuntimeCaching,
} from "serwist";
import { API_CACHE_NAME } from "@/features/pwa/api-cache";
import { runtimeCachingWith, serverErrorFallsBackToCache } from "@/features/pwa/runtime-caching";

/*
 * Governance (ADR 0004/0009): the worker app may keep exactly two API responses on the device, the forecast of a
 * site and the risk policy. Workers can share a phone, so every other /api/ response (a subscription, a crew
 * timeline, later anything about the worker) must go to the network every time and never into Cache Storage.
 *
 * Serwist's defaultCache has a catch-all same-origin /api/ rule (cache "apis", 24 h). These tests resolve requests
 * through Serwist's own router, with the real production defaultCache behind our rules, so they fail if the order
 * stops protecting the other endpoints.
 */

const ORIGIN = "https://worker.example";

// Set before any import below runs (vi.hoisted), because the libraries read them while loading:
//  - NODE_ENV "production": @serwist/turbopack/worker's defaultCache is a single NetworkOnly rule in any other mode,
//    and the production list is the one that ships;
//  - self and location: Serwist's constructor and its router use the worker's global scope.
vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubGlobal("self", { addEventListener: vi.fn(), skipWaiting: vi.fn() });
  vi.stubGlobal("location", new URL("https://worker.example/serwist/sw.js"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function routerOver(runtimeCaching: RuntimeCaching[]): Serwist {
  return new Serwist({ runtimeCaching });
}

/** The handler Serwist's router picks for a request, or undefined when no route would handle it (the browser goes to the network). */
function handlerFor(serwist: Serwist, target: string, method = "GET") {
  const url = new URL(target, ORIGIN);
  const request = new Request(url, { method });
  const sameOrigin = url.origin === ORIGIN;
  return serwist.findMatchingRoute({ url, sameOrigin, request, event: {} as ExtendableEvent }).route?.handler;
}

describe("the worker's runtime caching of /api/", () => {
  it("is a real production defaultCache (guards the other tests against a vacuous pass)", () => {
    expect(productionDefaults.length).toBeGreaterThan(5);
  });

  it("would, without our rules, keep any /api/ GET in the 'apis' cache: the order is what protects them", () => {
    const handler = handlerFor(routerOver(productionDefaults), "/api/v1/crews/crew-a/timeline");
    expect(handler).toBeInstanceOf(NetworkFirst);
    expect((handler as NetworkFirst).cacheName).toBe("apis");
  });

  const router = () => routerOver(runtimeCachingWith(productionDefaults));

  it.each(["/api/v1/sites/site-demo-mussafah/forecast/today", "/api/v1/risk-policy"])(
    "%s: NetworkFirst in the sb-api cache",
    (path) => {
      const handler = handlerFor(router(), path);
      expect(handler).toBeInstanceOf(NetworkFirst);
      expect((handler as NetworkFirst).cacheName).toBe(API_CACHE_NAME);
    },
  );

  it.each([
    "/api/v1/sites",
    "/api/v1/sites/site-demo-mussafah",
    "/api/v1/sites/site-demo-mussafah/crews",
    "/api/v1/crews/crew-a/timeline",
    "/api/v1/crews/crew-a/timeline?date=2026-11-11",
    "/api/v1/push/subscriptions",
    "/api/v1/push/subscriptions/sub-1",
    "/api/v1/sites/site-demo-mussafah/forecast/today/extra",
    "/api/v1/sites/site-demo-mussafah/forecast",
    "/api/v1/risk-policy/extra",
    // A file extension would send these to defaultCache's json rule ("static-data-assets") if it came first.
    "/api/v1/risk-policy.json",
    "/api/v1/sites/site-demo-mussafah/forecast/today.json",
    "/api/healthz",
    "/api/anything/else",
  ])("%s: NetworkOnly, never stored", (path) => {
    const handler = handlerFor(router(), path);
    expect(handler).toBeInstanceOf(NetworkOnly);
  });

  it("does not treat another origin's forecast or policy as the allow-listed ones", () => {
    const handler = handlerFor(router(), "https://elsewhere.example/api/v1/risk-policy");
    expect(handler).toBeDefined();
    expect((handler as NetworkFirst).cacheName).not.toBe(API_CACHE_NAME);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "leaves a %s to the network: no route handles it, so nothing is cached",
    (method) => {
      expect(handlerFor(router(), "/api/v1/push/subscriptions", method)).toBeUndefined();
      expect(handlerFor(router(), "/api/v1/risk-policy", method)).toBeUndefined();
    },
  );

  it("puts the rules for /api/ ahead of every defaultCache rule", () => {
    const rules = runtimeCachingWith(productionDefaults);
    expect(rules.slice(2)).toEqual(productionDefaults);
    expect(rules[0]?.method).toBe("GET");
    expect(rules[1]?.method).toBe("GET");
  });
});

describe("serverErrorFallsBackToCache", () => {
  const request = new Request(`${ORIGIN}/api/v1/risk-policy`);
  const event = {} as ExtendableEvent;

  function succeeded(status: number, state: PluginState) {
    // A response with a null body status (204, 304) cannot carry a body.
    const body = status === 204 || status === 304 ? null : "body";
    return serverErrorFallsBackToCache.fetchDidSucceed({ request, event, response: new Response(body, { status }), state });
  }

  it.each([200, 204, 301, 304, 400, 401, 404, 422, 429])("lets a %i response through", (status) => {
    expect(succeeded(status, {}).status).toBe(status);
  });

  it.each([500, 502, 503, 504, 599])("treats a %i response as a failed fetch, so NetworkFirst uses its cached copy", (status) => {
    expect(() => succeeded(status, {})).toThrow(String(status));
  });

  it("hands the original error response back when there is no cached copy, so the page still gets the problem body", async () => {
    const state: PluginState = {};
    const problem = new Response('{"request_id":"mock-req-1"}', { status: 502 });
    expect(() => serverErrorFallsBackToCache.fetchDidSucceed({ request, event, response: problem, state })).toThrow();
    const fallback = serverErrorFallsBackToCache.handlerDidError({ request, event, error: new Error("no-response"), state });
    expect(fallback).toBe(problem);
    expect(await fallback?.text()).toBe('{"request_id":"mock-req-1"}');
  });

  it("has nothing to hand back for a failure that was not an error response, or for another request's state", () => {
    const error = new Error("network down");
    expect(serverErrorFallsBackToCache.handlerDidError({ request, event, error, state: {} })).toBeUndefined();
    const failed: PluginState = {};
    expect(() => succeeded(500, failed)).toThrow();
    expect(serverErrorFallsBackToCache.handlerDidError({ request, event, error, state: {} })).toBeUndefined();
  });
});

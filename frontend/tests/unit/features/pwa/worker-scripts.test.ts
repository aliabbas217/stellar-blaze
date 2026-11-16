// @vitest-environment node
import { defaultCache as productionDefaults } from "@serwist/turbopack/worker";
import { Serwist } from "serwist";
import { runtimeCachingWith } from "@/features/pwa/runtime-caching";
import { listenWithoutWorkerScripts } from "@/features/pwa/worker-scripts";

/*
 * "Missing worker bootstrap config" on the landing (seen once in a production gate run, then reproduced on EVERY load a service
 * worker controls). Turbopack hands the landing's terrain worker its bootstrap config in the `#params=` fragment of the worker
 * script's URL, and the worker reads it back from its own `self.location`. A worker's location is the URL of the RESPONSE that
 * delivered its script. A response the service worker answers from Cache Storage (the precache, which holds every `_next/static`
 * chunk including `turbopack-worker-*.js`, or defaultCache's CacheFirst rule for `/_next/static/**.js`) carries the URL it was
 * stored under, which has no fragment: the worker starts with no config, throws, and the page falls back to 2D with a console
 * error. A response the worker fetches from the network keeps the fragment, and so does a request the worker does not answer.
 * Browser proof of all four cases: tests/e2e/judge-landing-sw.spec.ts.
 *
 * So the service worker must never answer the request for a worker script. These tests run Serwist's real listeners, over the
 * real production defaultCache and a precache that holds the worker chunk, and look at whether the fetch event is answered.
 */

const ORIGIN = "https://worker.example";
const WORKER_CHUNK = "/_next/static/chunks/turbopack-worker-1hrsqshz0gfey.js";
const OTHER_CHUNK = "/_next/static/chunks/34towr58gn6-5.js";

// Before any import below runs: the libraries read the worker's global scope while loading, and defaultCache is a single
// NetworkOnly rule outside production.
const scope = vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "production");
  const target = new EventTarget();
  const fake = Object.assign(target, { skipWaiting: vi.fn() });
  vi.stubGlobal("self", fake);
  vi.stubGlobal("location", new URL("https://worker.example/serwist/sw.js"));
  return fake;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Destination = "" | "script" | "worker" | "sharedworker" | "document" | "image";

/** A Request-shaped object: Node's Request cannot be given a `destination` (the browser sets it), and Serwist reads only these. */
function fetchEventFor(path: string, destination: Destination): { event: Event; answered: () => boolean } {
  const request = { url: new URL(path, ORIGIN).href, method: "GET", destination, mode: "same-origin", headers: new Headers() };
  let answered = false;
  const event = Object.assign(new Event("fetch", { cancelable: true }), {
    request,
    waitUntil: () => undefined,
    respondWith: (response: Promise<Response>) => {
      answered = true;
      response.catch(() => undefined); // the handler has no Cache Storage here and fails; whether it was ASKED is what these tests read
    },
  });
  return { event, answered: () => answered };
}

/** The production wiring of src/app/sw.ts: the precache holds every static chunk, the runtime rules are the production ones. */
function productionSerwist(): Serwist {
  return new Serwist({
    precacheEntries: [
      { url: WORKER_CHUNK, revision: null },
      { url: OTHER_CHUNK, revision: null },
    ],
    runtimeCaching: runtimeCachingWith(productionDefaults),
  });
}

/** A fresh scope for one test: Serwist and the guard add listeners to the global `self`, and a test must not see the last one's. */
const listeners: [string, EventListenerOrEventListenerObject][] = [];
beforeEach(() => {
  const add = scope.addEventListener.bind(scope);
  vi.spyOn(scope, "addEventListener").mockImplementation((type, listener, options) => {
    listeners.push([type, listener as EventListenerOrEventListenerObject]);
    add(type, listener, options);
  });
});
afterEach(() => {
  for (const [type, listener] of listeners.splice(0)) scope.removeEventListener(type, listener);
  vi.restoreAllMocks();
});

describe("the service worker and the scripts of dedicated workers", () => {
  it("is a real precache hit and a real runtime rule (guards the tests below against a vacuous pass)", () => {
    // Without our guard (Serwist's own listeners), both the precache and defaultCache's rule would answer a worker script.
    productionSerwist().addEventListeners();
    for (const path of [WORKER_CHUNK, OTHER_CHUNK, "/_next/static/chunks/not-in-the-precache.js"]) {
      const { event, answered } = fetchEventFor(path, "worker");
      scope.dispatchEvent(event);
      expect(answered(), `${path} is answered by Serwist when nothing guards it`).toBe(true);
    }
  });

  it.each<[string, Destination]>([
    [WORKER_CHUNK, "worker"], // the precached entry: the bootstrap's own script
    ["/_next/static/chunks/not-in-the-precache.js", "worker"], // a later build's worker chunk: defaultCache's CacheFirst rule would take it
    [WORKER_CHUNK, "sharedworker"],
  ])("%s requested as a %s: not answered, the browser fetches it itself and the #params fragment survives", (path, destination) => {
    listenWithoutWorkerScripts(productionSerwist(), scope);
    const { event, answered } = fetchEventFor(path, destination);
    scope.dispatchEvent(event);
    expect(answered()).toBe(false);
  });

  it.each<[string, Destination]>([
    [WORKER_CHUNK, "script"], // what the worker's importScripts asks for: no location depends on it, and it is part of the offline app
    [OTHER_CHUNK, "script"],
    ["/_next/static/chunks/not-in-the-precache.js", "script"],
    ["/_next/static/media/logo.svg", "image"],
  ])("%s requested as a %s: still answered by the worker's caches (the guard is for worker scripts only)", (path, destination) => {
    listenWithoutWorkerScripts(productionSerwist(), scope);
    const { event, answered } = fetchEventFor(path, destination);
    scope.dispatchEvent(event);
    expect(answered()).toBe(true);
  });

  it("still adds Serwist's own install, activate, fetch and message listeners (the guard is one fetch listener more)", () => {
    listenWithoutWorkerScripts(productionSerwist(), scope);
    const types = listeners.map(([type]) => type);
    expect(types.filter((type) => type === "fetch")).toHaveLength(2);
    expect(types).toEqual(expect.arrayContaining(["install", "activate", "message"]));
  });
});

import type { Serwist } from "serwist";

/*
 * The service worker never answers the request for the SCRIPT OF A WORKER (a dedicated or shared worker a page starts).
 *
 * Why: Turbopack puts the bootstrap config of a worker in the `#params=` fragment of the worker script's URL, and the worker
 * reads it back from its own `self.location` (`.next/static/chunks/turbopack-worker-*.js`: no config, it logs "Missing worker
 * bootstrap config" and throws). A worker's `self.location` is the URL of the response that delivered its script. A response
 * the service worker serves from Cache Storage (the precache, which holds every `_next/static` chunk, or Serwist's CacheFirst
 * rule for `/_next/static/**.js`) has the URL it was stored under, and that has no fragment: the landing's terrain worker started
 * with no config on every load the service worker controlled, and the page fell back to the 2D field. A response from the network
 * keeps the fragment (a `fetch(event.request)` too), and so does a request the service worker leaves alone, which is what is done
 * here: no `respondWith`, the browser fetches the script itself (and its own HTTP cache applies: the chunk is immutable).
 *
 * What it costs: the service worker no longer serves a worker script offline. The browser's own HTTP cache still can (the chunk is
 * immutable: an offline returning visitor who loaded it keeps the scene, measured), and where it cannot the only worker, the
 * landing's WebGL scene, gives itself up on the worker error (FieldCanvasGL `onerror`) and leaves the 2D field of the same data.
 *
 * Only `destination` "worker" and "sharedworker" are skipped. The chunks a worker pulls in with `importScripts` are "script"
 * requests: no location depends on them, and they stay in the precache.
 *
 * The check is on the request's destination, not on a file name, so it holds for a worker chunk of any later build, of any
 * bundler's naming, and for a worker script a library adds.
 */

const WORKER_DESTINATIONS: ReadonlySet<string> = new Set(["worker", "sharedworker"]);

/** True when the request is a browser asking for the script of a worker it is about to start. */
export function isWorkerScriptRequest(request: Pick<Request, "destination">): boolean {
  return WORKER_DESTINATIONS.has(request.destination);
}

/**
 * Serwist's `addEventListeners()` with the guard in front of its `fetch` listener: for a worker script the guard stops the
 * event, so Serwist's listener never runs, nothing calls `respondWith`, and the request goes to the network as if there were no
 * service worker. Use this INSTEAD OF `serwist.addEventListeners()`, so the order cannot be got wrong.
 */
export function listenWithoutWorkerScripts(
  serwist: Pick<Serwist, "addEventListeners">,
  scope: Pick<ServiceWorkerGlobalScope, "addEventListener">,
): void {
  scope.addEventListener("fetch", (event) => {
    if (isWorkerScriptRequest(event.request)) event.stopImmediatePropagation();
  });
  serwist.addEventListeners();
}

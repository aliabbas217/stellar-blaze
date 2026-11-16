import { whenNoSafetyFlight } from "@/lib/safety-flight";

/*
 * Asks the browser to look for a newer service worker, once per page load (LocalePrefs, in the root layout, calls this).
 *
 * Why: a returning visitor keeps the OLD service worker until the browser's own check (up to about 24 h). Build B's page under
 * build A's worker was the cause of the landing falling back to 2D (src/features/pwa/worker-scripts.ts, task-wk-report.md); after
 * `registration.update()` the next load ran the new worker. `sw.ts` has `skipWaiting` and `clientsClaim`, so a newly installed
 * worker takes over without a reload; the page is not reloaded either (`reloadOnOnline` stays false).
 *
 * Never while a Stop is in flight (safety-flight.ts): the check waits for the last one to settle, then runs once. An update check
 * that fails (offline is normal) is ignored: no console output, no unhandled rejection.
 */

let started = false;

/** Test hook: a fresh page load. */
export function resetUpdateCheckForTest(): void {
  started = false;
}

export function checkForNewWorkerOnce(): void {
  if (started) return;
  started = true;
  whenNoSafetyFlight(() => {
    try {
      // The DOM type says `serviceWorker` is always there; an insecure address and some private windows leave it undefined.
      const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
      void container
        ?.getRegistration()
        .then((registration) => registration?.update())
        .catch(() => undefined);
    } catch {
      // No service worker API (an insecure address, a private window), or it threw: nothing to update.
    }
  });
}

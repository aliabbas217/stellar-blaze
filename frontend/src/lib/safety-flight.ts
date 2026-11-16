/*
 * Which safety writes (Stop work and its undo or resume) are on the wire right now. Nothing else may share a moment with them
 * that could disturb the page: today the one reader is the service worker update check (update-check.ts), which waits for the
 * last one to settle. A tiny module on purpose: the root layout imports it, so every route pays for it.
 */

let inFlight = 0;
let waiting: Array<() => void> = [];

/** Counts `work` as in flight until it settles, whichever way it settles. Returns `work` itself, so a caller still sees its result or error. */
export function trackSafetyFlight<T>(work: Promise<T>): Promise<T> {
  inFlight += 1;
  const settled = (): void => {
    inFlight -= 1;
    if (inFlight > 0) return;
    const due = waiting;
    waiting = [];
    for (const run of due) run();
  };
  work.then(settled, settled);
  return work;
}

/** Runs `run` now when no safety write is in flight, else once, when the last one has settled. */
export function whenNoSafetyFlight(run: () => void): void {
  if (inFlight === 0) run();
  else waiting.push(run);
}

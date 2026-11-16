/*
 * Whether the page may try the WebGL scene at all. The scene needs an OffscreenCanvas it can hand to a worker, and a worker;
 * creating a WebGL context is itself the last test (it can still fail in the worker, and the scene then gives way to the 2D
 * field). `?static` forces the 2D path for a reader who asks for it and for the design gate, which screenshots both paths.
 * Nothing here creates a context: that costs a GPU initialisation on the main thread.
 */

export interface UpgradeEnv {
  readonly search: string;
  readonly hasOffscreenCanvas: boolean;
  readonly canTransfer: boolean;
  readonly hasWorker: boolean;
}

export function canUpgrade(env: UpgradeEnv): boolean {
  if (new URLSearchParams(env.search).has("static")) return false;
  return env.hasOffscreenCanvas && env.canTransfer && env.hasWorker;
}

export function detectEnv(): UpgradeEnv {
  return {
    search: window.location.search,
    hasOffscreenCanvas: typeof OffscreenCanvas !== "undefined",
    canTransfer: "transferControlToOffscreen" in HTMLCanvasElement.prototype,
    hasWorker: typeof Worker !== "undefined",
  };
}

/** One pass of the day turns the desktop scene by 16 s x 0.025 rad/s. */
export const ORBIT_MAX_RAD = 0.4;

/**
 * `?orbit=<radians>` starts the WebGL scene at that point of its orbit (0 to one pass of the day, 0.4), anything else is 0. With reduced
 * motion the day rests there, so a test or a gate shot gets a deterministic pose instead of a moment of an autoplay: the contrast spec
 * samples the copy over the map at several azimuths this way.
 */
export function orbitFromSearch(search: string): number {
  const raw = new URLSearchParams(search).get("orbit");
  if (raw === null || raw.trim() === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, ORBIT_MAX_RAD);
}

interface IdleWindow {
  requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
}

/** Runs `run` when the page is idle (at the latest after `timeoutMs`); a browser without idle callbacks runs it after 300 ms. Returns the cancel. */
export function whenIdle(run: () => void, timeoutMs = 1500): () => void {
  const w = window as unknown as IdleWindow;
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(run, { timeout: timeoutMs });
    return () => {
      w.cancelIdleCallback?.(id);
    };
  }
  const id = window.setTimeout(run, 300);
  return () => {
    window.clearTimeout(id);
  };
}

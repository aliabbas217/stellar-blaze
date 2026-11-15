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

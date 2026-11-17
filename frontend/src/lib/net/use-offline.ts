"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Whether the browser says it has no connection. `navigator.onLine` is right when it says offline and only a guess when
 * it says online (a Wi-Fi with no internet reads as online), so it is a lower bound: a request that fails with no answer
 * is the other half of the same fact. On the server, and while hydrating, it reads as online.
 */
export function useOffline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !navigator.onLine,
    () => false,
  );
}

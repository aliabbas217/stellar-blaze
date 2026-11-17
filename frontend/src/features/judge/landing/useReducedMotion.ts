"use client";

import { useSyncExternalStore } from "react";

/*
 * The reader's `prefers-reduced-motion`, read live: an operating-system setting changed while the page is open is heard (a one-time
 * read at mount would keep playing a day the reader just asked not to see). The server snapshot is false; the landing island is
 * client-only, so it never renders from it.
 */

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

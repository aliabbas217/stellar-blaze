/*
 * The landing's ONE passive scroll listener. Everything that follows the scroll (the pinned forecast scene's hour, camera and captions, the
 * rail's current chapter) subscribes here and reads the page for itself when it is called, once per animation frame at most. Native scroll is
 * never touched (no wheel handler, no scroll-jacking, no library). The listener exists only while something is subscribed.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let attached = false;
let queued = 0;

function run(): void {
  queued = 0;
  for (const listener of listeners) listener();
}

function onEvent(): void {
  if (queued === 0) queued = requestAnimationFrame(run);
}

/** Calls `listener` once per frame while the page scrolls or resizes; returns the unsubscribe. */
export function subscribeScroll(listener: Listener): () => void {
  listeners.add(listener);
  if (!attached) {
    window.addEventListener("scroll", onEvent, { passive: true });
    window.addEventListener("resize", onEvent);
    attached = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && attached) {
      window.removeEventListener("scroll", onEvent);
      window.removeEventListener("resize", onEvent);
      if (queued !== 0) cancelAnimationFrame(queued);
      queued = 0;
      attached = false;
    }
  };
}

/** The wide layout pins the forecast scene; narrow and reduced motion are a plain column (the same query as landing.css). */
export const NARROW_QUERY = "(max-width: 1099px)";
export const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** A media query list, or null where the browser has none (a test DOM): callers treat "no answer" as "no". */
export function media(query: string): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
}

export function isPinnedLayout(): boolean {
  return media(REDUCED_QUERY)?.matches !== true && media(NARROW_QUERY)?.matches !== true;
}

/** The chapter (1 to `count`) in view: the last whose top has passed 40 % of the window; the last one at the foot of the page. */
export function currentChapter(chapters: readonly { readonly top: number; readonly n: number }[], windowHeight: number, atFoot: boolean, count: number): number {
  if (atFoot) return count;
  let on = 1;
  for (const chapter of chapters) if (chapter.top <= windowHeight * 0.4) on = chapter.n;
  return on;
}

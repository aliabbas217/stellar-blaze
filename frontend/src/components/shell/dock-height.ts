import { useCallback, type RefCallback } from "react";

/**
 * A fixed bottom bar is not part of the page's flow, so the page must (a) end above it and (b) scroll a control into view ABOVE it,
 * never under it (WCAG 2.2 Focus Not Obscured). The dock measures itself and publishes its height as this custom property on the
 * root; `FieldShell` pads the page's end with it and `globals.css` reads it for `scroll-padding-bottom`. The supervisor's Stop work bar
 * does the same with `--stop-bar-height` (StopWorkBar.tsx). The property is removed when the dock goes.
 */
export const DOCK_HEIGHT_VAR = "--worker-dock-height";

/** The class a field page puts on its content so the last row scrolls clear of the dock (the fallback is the dock's height at the largest text, 11rem). */
export const DOCK_CLEARANCE = "pb-[calc(var(--worker-dock-height,11rem)+1rem)]";

export function useDockHeightPublisher(): RefCallback<HTMLDivElement> {
  return useCallback((dock: HTMLDivElement | null) => {
    if (dock === null) return undefined;
    const root = document.documentElement;
    const publish = (): void => {
      root.style.setProperty(DOCK_HEIGHT_VAR, `${String(Math.ceil(dock.getBoundingClientRect().height))}px`);
    };
    publish();
    // An engine without ResizeObserver keeps the height of the first measure.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(dock);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(DOCK_HEIGHT_VAR);
    };
  }, []);
}

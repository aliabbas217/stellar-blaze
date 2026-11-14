"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { components } from "@/api/schema";
import { DEMO_PARAM, parseDemoMode, pickDemoSite, REPLAY_DATE, type DemoMode } from "@/features/demo/constants";
import { sitesQueryOptions } from "@/features/demo/sites";
import { applyRouteTheme } from "@/lib/sun/route-theme";
import { DEMO_STORAGE_KEY } from "@/lib/sun/theme-storage";
import { useUrlParam } from "@/lib/url-state";

/*
 * The demo context of a screen that shows forecast data: which mode the visitor asked for (`?demo=live|replay`, replay
 * by default and on the server), the `date` the calls pass in that mode, and the demo site.
 *
 * The mode the visitor ASKED for is not the mode the data IS: the `mode` stamp comes from the forecast response
 * (useForecastMode in useClock.ts), and a "live" request answered with a replay is shown as such (DemoModeSwitch).
 *
 * The choice is mirrored to localStorage["sb-demo"] because the inline sun script reads it before paint, and the theme
 * is re-decided when it changes. Needs a QueryClientProvider above it (the sites query), so it is mounted only where
 * TanStack Query is: the worker and supervisor groups and the judge `(live)` sub-layout.
 */

type Site = components["schemas"]["Site"];

export interface DemoContextValue {
  /** The mode the visitor asked for. */
  readonly demo: DemoMode;
  readonly setDemo: (mode: DemoMode) => void;
  /** `date` for the forecast and timeline calls: the replay day in replay mode, `undefined` in live (the server decides). */
  readonly replayDate: string | undefined;
  /** The first synthetic site of `list_sites`, or null while it loads or when the list has none. */
  readonly site: Site | null;
  /** Every site `list_sites` returned (empty until it answers), for naming a pinned site. */
  readonly sites: readonly Site[];
  readonly siteStatus: "loading" | "error" | "ready";
}

const DemoContext = createContext<DemoContextValue | null>(null);

function readStored(): DemoMode | null {
  try {
    const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
    return raw === "live" || raw === "replay" ? raw : null;
  } catch {
    return null;
  }
}

function persist(mode: DemoMode): void {
  try {
    window.localStorage.setItem(DEMO_STORAGE_KEY, mode);
  } catch {
    // Blocked storage: the choice applies for this visit only.
  }
}

type UrlWriter = (mode: DemoMode) => void;

/**
 * Reads `?demo=` (the URL wins, then the stored choice) and registers the writer of it. It is its own component because
 * useSearchParams must sit in a small <Suspense> boundary: the children of the provider must not.
 */
function DemoUrlSync({ apply, writerRef }: { apply: (mode: DemoMode) => void; writerRef: { current: UrlWriter | null } }) {
  const [fromUrl, setUrl] = useUrlParam<DemoMode | null>(DEMO_PARAM, parseDemoMode, null);

  useEffect(() => {
    writerRef.current = setUrl;
    return () => {
      writerRef.current = null;
    };
  }, [setUrl, writerRef]);

  useEffect(() => {
    const next = fromUrl ?? readStored();
    if (next !== null) apply(next);
  }, [fromUrl, apply]);

  return null;
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [demo, setDemoState] = useState<DemoMode>("replay");
  const writer = useRef<UrlWriter | null>(null);
  const sites = useQuery(sitesQueryOptions());

  // The mode in force, readable without waiting for a render: URL sync and a tap can arrive in the same tick.
  const current = useRef<DemoMode>("replay");

  const apply = useCallback((mode: DemoMode) => {
    if (readStored() !== mode) persist(mode);
    if (current.current === mode) return;
    current.current = mode;
    setDemoState(mode);
    // The inline script decided with the old mode: decide again for this route.
    void applyRouteTheme(window.location.pathname);
  }, []);

  const setDemo = useCallback(
    (mode: DemoMode) => {
      apply(mode);
      writer.current?.(mode);
    },
    [apply],
  );

  const list = useMemo((): readonly Site[] => sites.data ?? [], [sites.data]);
  const site = useMemo(() => pickDemoSite(list), [list]);
  const siteStatus = sites.isError ? "error" : sites.data === undefined ? "loading" : "ready";

  const value = useMemo<DemoContextValue>(
    () => ({ demo, setDemo, replayDate: demo === "replay" ? REPLAY_DATE : undefined, site, sites: list, siteStatus }),
    [demo, setDemo, site, list, siteStatus],
  );

  return (
    <DemoContext.Provider value={value}>
      <Suspense fallback={null}>
        <DemoUrlSync apply={apply} writerRef={writer} />
      </Suspense>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo(): DemoContextValue {
  const value = useContext(DemoContext);
  if (value === null) throw new Error("useDemo must be used inside <DemoProvider>.");
  return value;
}

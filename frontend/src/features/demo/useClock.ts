"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTimeZone } from "next-intl";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AT_PARAM, REPLAY_HHMM } from "@/features/demo/constants";
import { replayInstant, parseHhmm } from "@/lib/time/clock";
import { useUrlParam } from "@/lib/url-state";

/*
 * The demo clock (F2 review focus 6, replay and live confusion). When the last forecast response says
 * `mode: "replay"`, the app's "now" is the replay moment: that response's own date at 11:10 in the site's zone (`?at=HH:MM`
 * moves it), so every screen reads the hour the recorded forecast covers. Otherwise it is the device clock, read again
 * every minute. The switch in the header is never the source: only the API's `mode` stamp is (ADR 0051 decision 4).
 */

/** The prefix of the query keys of a site's forecast for today (`queryKeys.today(siteId)` is `["today", siteId]`). */
const FORECAST_KEY_PREFIX = ["today"] as const;

interface ForecastStamp {
  readonly mode: "live" | "replay";
  readonly date: string;
}

function toStamp(data: unknown): ForecastStamp | null {
  if (typeof data !== "object" || data === null) return null;
  const { mode, date } = data as Record<string, unknown>;
  return (mode === "live" || mode === "replay") && typeof date === "string" ? { mode, date } : null;
}

/**
 * `"<mode>|<date>"` of the most recently updated forecast response in the cache, or null when there is none. A string,
 * so that useSyncExternalStore can compare it by value.
 */
export function latestForecastStamp(client: QueryClient): string | null {
  let newest: { stamp: ForecastStamp; at: number } | null = null;
  for (const query of client.getQueryCache().findAll({ queryKey: FORECAST_KEY_PREFIX })) {
    const stamp = toStamp(query.state.data);
    if (stamp !== null && (newest === null || query.state.dataUpdatedAt >= newest.at)) {
      newest = { stamp, at: query.state.dataUpdatedAt };
    }
  }
  return newest === null ? null : `${newest.stamp.mode}|${newest.stamp.date}`;
}

function useForecastStampString(): string | null {
  const client = useQueryClient();
  const subscribe = useCallback((notify: () => void) => client.getQueryCache().subscribe(notify), [client]);
  return useSyncExternalStore(
    subscribe,
    () => latestForecastStamp(client),
    () => null,
  );
}

/** The `mode` of the last forecast response, or null before one has answered. The only thing that says "replay". */
export function useForecastMode(): "live" | "replay" | null {
  const stamp = useForecastStampString();
  if (stamp === null) return null;
  return stamp.startsWith("replay|") ? "replay" : "live";
}

/** How often the live clock is read again: a minute is the finest time any screen shows. */
const TICK_MS = 60_000;

function useDeviceNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const read = () => {
      setNow(new Date());
    };
    const timer = setInterval(read, TICK_MS);
    document.addEventListener("visibilitychange", read);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, []);
  return now;
}

/**
 * The time the app treats as now. Reads `?at=`, so the component that calls it belongs in its own <Suspense> boundary
 * (see src/lib/url-state.ts). Needs a QueryClientProvider above it.
 */
export function useClock(): Date {
  const stamp = useForecastStampString();
  const zone = useTimeZone() ?? "Asia/Dubai";
  const [at] = useUrlParam(AT_PARAM, parseHhmm, null);
  const device = useDeviceNow();

  return useMemo(() => {
    if (stamp === null || !stamp.startsWith("replay|")) return device;
    try {
      return replayInstant(stamp.slice("replay|".length), at ?? REPLAY_HHMM, zone);
    } catch {
      // A date the API should never send (the contract says YYYY-MM-DD): fall back to the device clock rather than throw in a header.
      return device;
    }
  }, [stamp, at, zone, device]);
}

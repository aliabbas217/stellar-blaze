"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTimeZone } from "next-intl";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AT_PARAM } from "@/features/demo/constants";
import { replayInstant, parseHhmm } from "@/lib/time/clock";
import { arrivalOf, serverNowAt } from "@/lib/time/server-clock";
import { useUrlParam } from "@/lib/url-state";

/*
 * The demo clock (F2 review focus 6, replay and live confusion; ADR 0034 amendment: one source of "now").
 *
 * When the last forecast response says `mode: "replay"`, the app's "now" is THE API'S clock: the `now` that response
 * carries plus the monotonic time elapsed since it arrived (src/lib/time/server-clock.ts), so every screen agrees with
 * the API about what time it is (a Stop is stamped by the same clock) and with every other screen. `?at=HH:MM` is the
 * judge's time travel: that time on the response's own date, in the site's zone. Otherwise (a live response) it is the
 * device clock, read again every minute.
 *
 * It is null while no time is known: before the first forecast has answered (the mode is not known yet), and in replay
 * mode when the response carries no reading. A caller shows its neutral "not yet" reading then; the app never invents a
 * time. The switch in the header is never the source: only the API's `mode` stamp is (ADR 0051 decision 4).
 */

/** The prefix of the query keys of a site's forecast for today (`queryKeys.today(siteId)` is `["today", siteId]`). */
const FORECAST_KEY_PREFIX = ["today"] as const;

interface ForecastStamp {
  readonly mode: "live" | "replay";
  readonly date: string;
  /** The API's `now` as epoch milliseconds, with the monotonic time its response arrived: both, or neither. */
  readonly reading: { readonly serverNowMs: number; readonly arrivedAtMs: number } | null;
}

function toStamp(data: unknown): ForecastStamp | null {
  if (typeof data !== "object" || data === null) return null;
  const { mode, date, now } = data as Record<string, unknown>;
  if ((mode !== "live" && mode !== "replay") || typeof date !== "string") return null;
  const serverNowMs = typeof now === "string" ? Date.parse(now) : Number.NaN;
  const arrivedAtMs = arrivalOf(data);
  const reading = Number.isNaN(serverNowMs) || arrivedAtMs === undefined ? null : { serverNowMs, arrivedAtMs };
  return { mode, date, reading };
}

/**
 * `"<mode>|<date>|<api now ms>|<arrival ms>"` of the most recently updated forecast response in the cache (the last two
 * empty when it carries no reading), or null when there is none. A string, so that useSyncExternalStore can compare it by value.
 */
export function latestForecastStamp(client: QueryClient): string | null {
  let newest: { stamp: ForecastStamp; at: number } | null = null;
  for (const query of client.getQueryCache().findAll({ queryKey: FORECAST_KEY_PREFIX })) {
    const stamp = toStamp(query.state.data);
    if (stamp !== null && (newest === null || query.state.dataUpdatedAt >= newest.at)) {
      newest = { stamp, at: query.state.dataUpdatedAt };
    }
  }
  if (newest === null) return null;
  const { mode, date, reading } = newest.stamp;
  return `${mode}|${date}|${reading === null ? "" : String(reading.serverNowMs)}|${reading === null ? "" : String(reading.arrivedAtMs)}`;
}

function parseStamp(stamp: string): ForecastStamp {
  const [mode, date = "", serverNow = "", arrivedAt = ""] = stamp.split("|");
  return {
    mode: mode === "replay" ? "replay" : "live",
    date,
    reading: serverNow === "" || arrivedAt === "" ? null : { serverNowMs: Number(serverNow), arrivedAtMs: Number(arrivedAt) },
  };
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

/** How often the device clock is read again: a minute is the finest time any screen shows. */
const TICK_MS = 60_000;
/** How often the API's clock is worked out again: often enough that a minute change shows within seconds of it. */
const REPLAY_TICK_MS = 5_000;

/** A reading of `read()` that is taken again every `everyMs` and whenever the tab becomes visible again. */
function useTicking<T>(read: () => T, everyMs: number, active: boolean): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    if (!active) return undefined;
    const update = () => {
      setValue(read());
    };
    update();
    const timer = setInterval(update, everyMs);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [read, everyMs, active]);
  return value;
}

const readDevice = (): Date => new Date();
const readMonotonic = (): number => performance.now();

/** The device clock, to the minute it is read. Exposed for a screen that must fall back to it when no forecast can answer. */
export function useDeviceClock(): Date {
  return useTicking(readDevice, TICK_MS, true);
}

/**
 * The time the app treats as now, or null while it is not known (see the top of this file). Reads `?at=`, so the
 * component that calls it belongs in its own <Suspense> boundary (see src/lib/url-state.ts). Needs a QueryClientProvider above it.
 */
export function useClock(): Date | null {
  const stampString = useForecastStampString();
  const stamp = useMemo(() => (stampString === null ? null : parseStamp(stampString)), [stampString]);
  const zone = useTimeZone() ?? "Asia/Dubai";
  const [at] = useUrlParam(AT_PARAM, parseHhmm, null);
  const device = useDeviceClock();
  const followsApi = stamp?.mode === "replay" && at === null && stamp.reading !== null;
  const monotonicNow = useTicking(readMonotonic, REPLAY_TICK_MS, followsApi);

  const instantMs = useMemo((): number | null => {
    if (stamp === null) return null;
    if (stamp.mode === "live") return device.getTime();
    if (at !== null) {
      try {
        return replayInstant(stamp.date, at, zone).getTime();
      } catch {
        // A date the API should never send (the contract says YYYY-MM-DD): no time is known, rather than a wrong one.
        return null;
      }
    }
    return stamp.reading === null ? null : serverNowAt(stamp.reading.serverNowMs, stamp.reading.arrivedAtMs, monotonicNow).getTime();
  }, [stamp, at, zone, device, monotonicNow]);
  // One Date per instant: the screens memoize on it, and the API's clock is worked out every few seconds but moves by the minute.
  return useMemo(() => (instantMs === null ? null : new Date(instantMs)), [instantMs]);
}

/**
 * `useClock()` for a screen that asks for the forecast itself (the supervisor's): `now` is always a Date to compute with, and
 * `pending` says it is not the API's yet, so the screen stays in its loading state instead of drawing anything from it.
 * `forecastCannotAnswer` (the forecast request failed, or there is no site to ask about) ends the wait: the device clock is
 * what is left, which is what the screen used before the API's clock existed. While the wait lasts, `now` is the device
 * clock only so that hooks have a value; it must not reach the screen.
 */
export function useClockOrDevice(forecastCannotAnswer: boolean): { readonly now: Date; readonly pending: boolean } {
  const clock = useClock();
  const device = useDeviceClock();
  return { now: clock ?? device, pending: clock === null && !forecastCannotAnswer };
}

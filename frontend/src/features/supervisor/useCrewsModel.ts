"use client";

import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useLocale, useTimeZone } from "next-intl";
import { useMemo } from "react";
import { crewDayPlanQueryOptions, crewTimelineQueryOptions, crewsQueryOptions, siteForecastQueryOptions } from "@/api/queries";
import type { ApiProblem, Problem } from "@/api/problem";
import type { components } from "@/api/schema";
import { banStateFrom, type BanState } from "@/components/spine/ban-state";
import { useDemo } from "@/features/demo/DemoProvider";
import { sitesQueryOptions } from "@/features/demo/sites";
import { useClockOrDevice } from "@/features/demo/useClock";
import { buildCrewModels, type CrewStripModel } from "@/features/supervisor/crew-model";
import { forecastFreshness } from "@/lib/forecast/freshness";
import { useOffline } from "@/lib/net/use-offline";
import { hourOfDay, localDate } from "@/lib/time/zone";

/*
 * Everything the crews screen needs, as one model (F2 Task 19): the site (the demo context's), the crews and each crew's
 * timeline, the site forecast (for the replay stamp, the freshness rule and the heat colour of each hour), and one day plan,
 * the focal crew's, for its work and rest minutes.
 *
 * Requests: crews (1) + forecast (1) + one timeline per crew + one day plan = 7 for the demo's four crews, once. Nothing
 * polls. `staleTime` is 30 s, so a refocus never re-asks faster than the BFF's per-client budget allows (the day plan GET
 * counts against the general budget: ruling). A stop, an undo and a resume invalidate the crew queries (useStopWork), which
 * is the mutation-driven refresh.
 */

type Crew = components["schemas"]["Crew"];
type SiteForecastToday = components["schemas"]["SiteForecastToday"];

/** No faster than once per 30 s per screen (the BFF general budget is 20 per minute per client). */
const STALE_MS = 30_000;

export type CrewsModel =
  /** The demo site is not known yet (the sites list is loading). */
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly problem: Problem | null; readonly retry: () => void }
  | { readonly status: "empty" }
  | {
      readonly status: "ready";
      readonly siteName: string;
      readonly crews: readonly CrewStripModel[];
      /** The crew that needs the supervisor first: the top of the ranking. */
      readonly focal: CrewStripModel;
      readonly now: Date;
      readonly zone: string;
      /** The hours the strips span (the timelines' own first and last hour). */
      readonly from: number;
      readonly to: number;
      /** The current time as an hour of the site's day, or null when the data is for another day. */
      readonly nowHour: number | null;
      readonly ban: BanState;
      /** Local hour to WBGT p50 of the site forecast, from a fresh forecast only: heat colour appears on live data alone. */
      readonly heat: ReadonlyMap<number, number>;
      readonly mode: SiteForecastToday["mode"] | null;
      /** No fresh forecast: the crews see the protective plan. */
      readonly protective: boolean;
      readonly offline: boolean;
      /** The names of the crews below k, for the privacy footnote, and k. */
      readonly suppressedNames: readonly string[];
      readonly k: number | null;
      /** Minutes to the midday break when it is in force and still ahead, else null. */
      readonly breakInMinutes: number | null;
      readonly crewsUpdatedAt: number;
    };

const NO_CREWS: readonly Crew[] = [];

type CrewTimeline = components["schemas"]["CrewTimeline"];

interface Timelines {
  /** The timelines that have arrived, by crew id. */
  readonly byId: Readonly<Record<string, CrewTimeline | undefined>>;
  /** At least one is still being asked for for the first time (a crew that failed to answer is settled: it has no level). */
  readonly pending: boolean;
}

/** Stable between renders while no timeline changed (TanStack Query shares structure). */
function combineTimelines(results: UseQueryResult<CrewTimeline, ApiProblem>[]): Timelines {
  const byId: Record<string, CrewTimeline | undefined> = {};
  for (const result of results) if (result.data !== undefined) byId[result.data.crew_id] = result.data;
  return { byId, pending: results.some((result) => result.isPending) };
}

export function useCrewsModel(): { readonly model: CrewsModel; readonly siteId: string | null; readonly siteName: string | null } {
  const { site, siteStatus } = useDemo();
  // The same query the demo context runs (one cache entry, no second request): only here for the failure's request id.
  const sitesQuery = useQuery(sitesQueryOptions());
  const sitesProblem = sitesQuery.error?.problem ?? null;
  const siteId = site?.id ?? null;
  const enabled = siteId !== null;
  const locale = useLocale();
  const zone = useTimeZone() ?? "Asia/Dubai";
  const offline = useOffline();

  const crewsQuery = useQuery({ ...crewsQueryOptions(siteId ?? ""), enabled, staleTime: STALE_MS });
  const forecastQuery = useQuery({ ...siteForecastQueryOptions(siteId ?? ""), enabled, staleTime: STALE_MS });
  // The API's clock arrives with the forecast. Until it has (or the forecast cannot answer) the screen is loading: ranking the crews
  // by the device's clock first and again by the API's would show one order and then another, and ask for two crews' plans.
  const { now, pending: clockPending } = useClockOrDevice(enabled ? forecastQuery.isError : siteStatus !== "loading");

  const crewList = crewsQuery.data ?? NO_CREWS;
  const { byId: timelines, pending: timelinesPending } = useQueries({
    queries: crewList.map((crew) => ({ ...crewTimelineQueryOptions(crew.id), staleTime: STALE_MS })),
    combine: combineTimelines,
  });

  // First pass without plans picks the focal crew; its day plan, once fetched, adds the cycle.
  const ranked = useMemo(() => buildCrewModels(crewList, timelines, undefined, now, zone), [crewList, timelines, now, zone]);
  const focalId = ranked[0]?.crew.id ?? null;
  const planQuery = useQuery({ ...crewDayPlanQueryOptions(focalId ?? ""), enabled: focalId !== null && !clockPending, staleTime: STALE_MS, retry: false });
  const plans = useMemo(() => (focalId === null || planQuery.data === undefined ? undefined : { [focalId]: planQuery.data }), [focalId, planQuery.data]);
  const crews = useMemo(() => buildCrewModels(crewList, timelines, plans, now, zone), [crewList, timelines, plans, now, zone]);

  const siteName = site?.name ?? null;
  const retry = () => {
    if (sitesQuery.isError) void sitesQuery.refetch();
    void crewsQuery.refetch();
    void forecastQuery.refetch();
  };

  if (siteId === null) {
    // The sites answered and none is a demo site (or none exists): nothing to list, which is the empty state, not a spinner.
    if (siteStatus === "ready") return { model: { status: "empty" }, siteId, siteName };
    return siteStatus === "error"
      ? { model: { status: "error", problem: sitesProblem, retry }, siteId, siteName }
      : { model: { status: "loading" }, siteId, siteName };
  }
  if (crewsQuery.isError && crewsQuery.data === undefined) {
    return { model: { status: "error", problem: crewsQuery.error.problem, retry }, siteId, siteName };
  }
  // The crews' levels come from their timelines: until each has answered (or failed) the screen is loading, never a "no level" sentence.
  if (crewsQuery.data === undefined || timelinesPending || clockPending) return { model: { status: "loading" }, siteId, siteName };
  const focal = crews[0];
  if (focal === undefined) return { model: { status: "empty" }, siteId, siteName };

  const forecast = forecastQuery.data;
  const forecastFresh = forecast !== undefined && forecastFreshness(forecast, now) === "fresh";
  const anyFallback =
    crewList.some((crew) => crew.plan_status === "fallback") ||
    Object.values(timelines).some((timeline) => timeline !== undefined && timeline.forecast_status !== "fresh");
  // A forecast that is missing, stale or a fallback is not live: the crews' plan is the protective one.
  const protective = !forecastFresh || anyFallback;

  const date = forecast?.date ?? localDate(now, zone);
  const window = forecast?.ban_window ?? Object.values(timelines).find((timeline) => timeline !== undefined)?.ban_window ?? null;
  const ban = banStateFrom(window, zone, date, locale);

  const heat = new Map<number, number>();
  if (forecastFresh) {
    for (const hour of forecast.hours) {
      if (hour.wbgt_c.p50 !== null) heat.set(Math.floor(hourOfDay(new Date(hour.starts_at), zone)), hour.wbgt_c.p50);
    }
  }

  const hours = crews.flatMap((crew) => crew.cells.map((cell) => cell.hour));
  const from = hours.length === 0 ? 6 : Math.min(...hours);
  const to = hours.length === 0 ? 19 : Math.max(...hours) + 1;
  const nowHour = localDate(now, zone) === date ? hourOfDay(now, zone) : null;
  const breakInMinutes = ban.kind === "in-force" && nowHour !== null && nowHour < ban.fromHour ? Math.round((ban.fromHour - nowHour) * 60) : null;
  const firstTimeline = Object.values(timelines).find((timeline) => timeline !== undefined);

  return {
    model: {
      status: "ready",
      siteName: siteName ?? "",
      crews,
      focal,
      now,
      zone,
      from,
      to,
      nowHour,
      ban,
      heat,
      // The crews' own data says what it is (B3 ba912f3: `mode` on CrewTimeline, optional); the forecast beside it is the fallback.
      mode: Object.values(timelines).find((timeline) => timeline?.mode !== undefined)?.mode ?? forecast?.mode ?? null,
      protective,
      offline,
      suppressedNames: crews.filter((crew) => crew.suppressed).map((crew) => crew.crew.name),
      k: firstTimeline?.k ?? null,
      breakInMinutes,
      crewsUpdatedAt: crewsQuery.dataUpdatedAt,
    },
    siteId,
    siteName,
  };
}

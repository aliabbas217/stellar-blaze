"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTimeZone } from "next-intl";
import { useMemo } from "react";
import { crewDayPlanQueryOptions, crewTimelineQueryOptions, crewsQueryOptions, siteForecastQueryOptions } from "@/api/queries";
import type { Problem } from "@/api/problem";
import type { components } from "@/api/schema";
import { banStateFrom, type BanState } from "@/components/spine/ban-state";
import { useDemo } from "@/features/demo/DemoProvider";
import { useClock } from "@/features/demo/useClock";
import { buildCrewModels, type CrewStripModel } from "@/features/supervisor/crew-model";
import { ackItemsOf, type PlanAckItem } from "@/features/supervisor/plan/derive-ack";
import { heatCells, planAxis, planBlocks, planFailureOf, type PlanBlock, type PlanFailure } from "@/features/supervisor/plan/plan-model";
import { forecastFreshness } from "@/lib/forecast/freshness";
import { useOffline } from "@/lib/net/use-offline";
import { hourOfDay, localDate } from "@/lib/time/zone";
import type { HeatCell } from "@/components/plan/PlanBars";

/*
 * Everything the plan screen needs for one crew, as one model (F2 Task 20).
 *
 * Requests, once per page load, nothing polls: the day plan (the one that draws on the BFF's general budget, 20 per minute per
 * client: fetched once, `staleTime` 30 s, no retry, so a refocus or a failure cannot spend more than that), the crews of the site
 * (the crew's name, task and stop state: the Stop bar needs the server's view of the stop), the crew's timeline (its level now and
 * k) and the site forecast (the Replay stamp, the freshness rule, the heat of each hour and the demo clock). The last three are
 * public reads and share their cache entries with the crews screen. A stop, an undo, a resume and a sign-off refresh them
 * (mutation-driven, never a timer).
 *
 * The plan request alone decides which screen state this is. The crew rows (the sentence, the Stop bar's crew name) arrive when
 * they arrive: the plan does not wait for them, and Stop work never waits for anything.
 */

type Crew = components["schemas"]["Crew"];
type DayPlan = components["schemas"]["DayPlan"];
type CrewTimeline = components["schemas"]["CrewTimeline"];
type SiteForecastToday = components["schemas"]["SiteForecastToday"];

/** No faster than once per 30 s per screen (the BFF general budget is 20 per minute per client). */
const STALE_MS = 30_000;

export type PlanScreenState =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly failure: PlanFailure; readonly problem: Problem; readonly retry: () => void }
  | { readonly status: "empty"; readonly plan: DayPlan }
  | {
      readonly status: "ready";
      readonly plan: DayPlan;
      readonly blocks: readonly PlanBlock[];
      readonly axis: { readonly from: number; readonly to: number };
      readonly heat: readonly (HeatCell | null)[];
      readonly ban: BanState;
      /** Now as site-local minutes since midnight, or null when the plan is for another day. */
      readonly nowMin: number | null;
      /** The index of the block that contains now, or -1. */
      readonly currentIndex: number;
      readonly items: readonly PlanAckItem[];
      /** No fresh forecast: the crews see the protective plan. */
      readonly protective: boolean;
      /**
       * The latest read of the plan failed in a way that does not say the plan is wrong (no network, a 5xx): the last plan stays on
       * screen as it was, under a notice, and sign-off is NOT offered on it (a sign-off must never be offered on a plan whose latest
       * read failed). `null` when the latest read succeeded.
       */
      readonly refreshFailed: { readonly retry: () => void } | null;
    };

export interface PlanScreen {
  readonly crewId: string;
  readonly siteId: string | null;
  readonly siteName: string | null;
  readonly zone: string;
  readonly now: Date;
  readonly offline: boolean;
  readonly mode: SiteForecastToday["mode"] | null;
  readonly crews: readonly Crew[] | undefined;
  readonly crewsUpdatedAt: number;
  readonly crew: Crew | undefined;
  readonly timeline: CrewTimeline | undefined;
  /** The crews row's level sentence model, once the crew and its timeline are both in. */
  readonly strip: CrewStripModel | null;
  /** The sentence is still waiting for the crew or its timeline (a request is in flight). */
  readonly stripPending: boolean;
  readonly breakInMinutes: number | null;
  /** Fewer than k people: show the k, never anything member-derived. */
  readonly state: PlanScreenState;
}

export function usePlanModel(crewId: string): PlanScreen {
  const { site } = useDemo();
  const siteId = site?.id ?? null;
  const enabled = siteId !== null;
  const locale = useLocale();
  const zone = useTimeZone() ?? "Asia/Dubai";
  const offline = useOffline();

  const planQuery = useQuery({ ...crewDayPlanQueryOptions(crewId), staleTime: STALE_MS, retry: false });
  const crewsQuery = useQuery({ ...crewsQueryOptions(siteId ?? ""), enabled, staleTime: STALE_MS });
  const timelineQuery = useQuery({ ...crewTimelineQueryOptions(crewId), staleTime: STALE_MS });
  const forecastQuery = useQuery({ ...siteForecastQueryOptions(siteId ?? ""), enabled, staleTime: STALE_MS });
  const now = useClock();

  const crews = crewsQuery.data;
  const crew = crews?.find((candidate) => candidate.id === crewId);
  const timeline = timelineQuery.data;
  // What the latest read of the plan says. TanStack keeps the old data when a refetch fails, so the data alone cannot be trusted:
  // a plan the validator now rejects, a shift that is now not legal, or a crew that is gone must REPLACE the cached plan (a validator-
  // failed plan is never shown and sign-off is off). Only a failure that says nothing about the plan (no network, a 5xx) keeps it.
  const latestFailure = planQuery.isError ? planFailureOf(planQuery.error.problem) : null;
  const replacesPlan = latestFailure !== null && latestFailure.kind !== "error";
  const plan = replacesPlan ? undefined : planQuery.data;
  const forecast = forecastQuery.data;

  const strip = useMemo(
    () => (crew === undefined || timeline === undefined ? null : (buildCrewModels([crew], { [crewId]: timeline }, plan === undefined ? undefined : { [crewId]: plan }, now, zone)[0] ?? null)),
    [crew, timeline, plan, crewId, now, zone],
  );
  const stripPending = strip === null && (crewsQuery.isPending || timelineQuery.isPending) && !(crewsQuery.isError || timelineQuery.isError);

  const state = ((): PlanScreenState => {
    if (planQuery.isError && plan === undefined) {
      const problem = planQuery.error.problem;
      return {
        status: "failed",
        failure: latestFailure ?? planFailureOf(problem),
        problem,
        retry: () => {
          void planQuery.refetch();
        },
      };
    }
    if (plan === undefined) return { status: "loading" };
    if (plan.segments.every((segment) => segment.state === "off")) return { status: "empty", plan };

    const blocks = planBlocks(plan, zone);
    const axis = planAxis(blocks);
    const forecastFresh = forecast !== undefined && forecastFreshness(forecast, now) === "fresh";
    // A forecast that is missing, stale or a fallback is not live: the crews see the protective plan, and no heat colour is drawn.
    const protective = plan.forecast_status !== "fresh" || plan.status === "fallback" || !forecastFresh;
    const ban = banStateFrom(plan.ban_window, zone, plan.date, locale);
    const nowMin = localDate(now, zone) === plan.date ? Math.round(hourOfDay(now, zone) * 60) : null;
    const currentIndex = nowMin === null ? -1 : blocks.findIndex((block) => block.fromMin <= nowMin && nowMin < block.toMin);
    return {
      status: "ready",
      plan,
      blocks,
      axis,
      heat: heatCells(forecast, zone, !protective),
      ban,
      nowMin,
      currentIndex,
      items: ackItemsOf(plan, zone),
      protective,
      refreshFailed: planQuery.isError
        ? {
            retry: () => {
              void planQuery.refetch();
            },
          }
        : null,
    };
  })();

  let breakInMinutes: number | null = null;
  if (state.status === "ready" && state.ban.kind === "in-force" && state.nowMin !== null && state.nowMin < state.ban.fromHour * 60) {
    breakInMinutes = Math.round(state.ban.fromHour * 60 - state.nowMin);
  }

  return {
    crewId,
    siteId,
    siteName: site?.name ?? null,
    zone,
    now,
    offline,
    // The plan says what it is (B3 ba912f3: `mode` on DayPlan and CrewTimeline, optional); when it is not served the timeline's, then the forecast's.
    mode: plan?.mode ?? timeline?.mode ?? forecast?.mode ?? null,
    crews,
    crewsUpdatedAt: crewsQuery.dataUpdatedAt,
    crew,
    timeline,
    strip,
    stripPending,
    breakInMinutes,
    state,
  };
}

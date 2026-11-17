"use client";

import { useQuery } from "@tanstack/react-query";
import { useTimeZone } from "next-intl";
import { useMemo } from "react";
import { crewTimelineQueryOptions } from "@/api/queries";
import type { Problem } from "@/api/problem";
import type { components } from "@/api/schema";
import { useFieldSiteLabel } from "@/components/shell/FieldHeading";
import { levelIndex, type Level } from "@/components/level/level";
import type { SpineCell } from "@/components/spine/TimeSpine";
import { useDemo } from "@/features/demo/DemoProvider";
import { useClock } from "@/features/demo/useClock";
import { alertWindow, crewHoursAsForecast, type AlertParams, type AlertWindow } from "@/features/alert/alert-params";
import { useSitePin } from "@/features/profile/site-pin";
import { actionPlan, type ActionPlan } from "@/features/today/action-codes";
import { hourOfDay, localDate } from "@/features/today/schedule";
import { useSiteToday } from "@/features/today/useSiteToday";

/*
 * Everything the alert card needs, as one model (F2 Task 17): the warning the notification named, the stretch of the day it
 * covers, and what to do. The card is opened from a tap on a notification with the app closed, so it must work from what
 * the phone holds:
 *
 *  - The identity comes from the notification's own query (`params`): level, audience, when it applies. If the forecast
 *    cannot be had (offline, or the request failed) the card still says the level and from when, from that: `saved`.
 *  - The window comes from the forecast (a site alert) or the crew's timeline (a crew alert). The card tells the truth
 *    about the forecast now: the level it shows is the forecast's, not the push's. An alert whose window is over is not shown
 *    as live: `ended`, and ONLY when the end is known and has passed. A forecast that cannot place the warning at all (no
 *    forecast level for that hour, an empty list, another day, a start in the future) says nothing about whether the heat has
 *    ended, so the card keeps the warning and the site rules (`saved`, cause "not-covered"): "ended" there would be false
 *    reassurance on a warning that may still apply.
 *  - The worker's own level is worked out here, on the phone, when the card opens, and shown only when it is higher.
 */

type Forecast = components["schemas"]["SiteForecastToday"];
type Timeline = components["schemas"]["CrewTimeline"];

export type AlertModel =
  | { readonly status: "loading" }
  | {
      /**
       * No window to read from the forecast: what the notification itself said, and the site rules. `cause` says why: the
       * forecast could not be had (offline with nothing saved, or the request failed), or it was had and does not place this
       * warning ("not-covered").
       */
      readonly status: "saved";
      readonly cause: "unavailable" | "not-covered";
      readonly offline: boolean;
      readonly problem: Problem | null;
      readonly retry: () => void;
    }
  | {
      /** The window's end is known and has passed. */
      readonly status: "ended";
      readonly endedAt: Date;
    }
  | {
      readonly status: "ready";
      readonly window: AlertWindow;
      readonly plan: ActionPlan;
      readonly cells: readonly SpineCell[];
      readonly from: number;
      readonly to: number;
      /** The hour of the window's start and end on the site's day, for the frame (`changedTo` null: to the end of the day drawn). */
      readonly changedFrom: number;
      readonly changedTo: number | null;
      readonly nowHour: number | null;
      /** The worker's own level, when it is strictly above the alert's. */
      readonly personalHigher: Level | null;
      /** A profile exists and the phone could not work its level out. */
      readonly personalUnavailable: boolean;
      readonly forecast: Forecast | null;
      readonly synthetic: boolean | null;
      readonly stale: boolean;
      readonly offline: boolean;
      readonly updatedAt: Date | null;
      readonly ageMs: number;
    };

const DEFAULT_FROM = 6;
const DEFAULT_TO = 18;

function shiftSpan(timeline: Timeline | undefined, zone: string): { from: number; to: number } {
  const ranges = timeline?.shift ?? [];
  if (ranges.length === 0) return { from: DEFAULT_FROM, to: DEFAULT_TO };
  const from = Math.floor(Math.min(...ranges.map((range) => hourOfDay(new Date(range.starts_at), zone))));
  const to = Math.ceil(Math.max(...ranges.map((range) => hourOfDay(new Date(range.ends_at), zone))));
  return to > from ? { from, to } : { from: DEFAULT_FROM, to: DEFAULT_TO };
}

export function useAlertModel(params: AlertParams): AlertModel {
  const clock = useClock();
  const zone = useTimeZone() ?? "Asia/Dubai";
  const { sites } = useDemo();
  const pin = useSitePin();

  const isCrew = params.audience === "crew";
  // A crew alert asks the crew's timeline which site it is for; a site alert already knows.
  const crewTimeline = useQuery({ ...crewTimelineQueryOptions(params.targetId), enabled: isCrew });
  const siteId = isCrew ? (crewTimeline.data?.site_id ?? null) : params.targetId;
  const today = useSiteToday(siteId ?? "", { now: clock, enabled: siteId !== null });
  // The shift drawn is the crew's: the alert's own crew, or the crew this phone is pinned to.
  const shiftCrewId = isCrew ? null : pin?.crewId ?? null;
  const ownTimeline = useQuery({ ...crewTimelineQueryOptions(shiftCrewId ?? ""), enabled: shiftCrewId !== null });
  const timeline: Timeline | undefined = isCrew ? crewTimeline.data : ownTimeline.data;

  const view = today.view;
  const hours = useMemo(
    () => (isCrew ? (crewTimeline.data === undefined ? null : crewHoursAsForecast(crewTimeline.data.hours)) : (view?.forecast.hours ?? null)),
    [isCrew, crewTimeline.data, view],
  );
  const window = useMemo(() => (hours === null ? null : alertWindow(hours, params.validFrom)), [hours, params.validFrom]);
  const generatedAt = useMemo(() => (view === null ? null : new Date(view.forecast.generated_at)), [view]);

  const failedOrWaiting = isCrew ? crewTimeline.isError : today.status === "error";
  const loaded = hours !== null;
  // The header names the warning's own site, whatever the phone is pinned to (or whether it is pinned at all).
  const siteName = siteId === null ? null : (sites.find((site) => site.id === siteId)?.name ?? siteId);
  useFieldSiteLabel(siteName);

  return useMemo((): AlertModel => {
    if (!loaded) {
      return failedOrWaiting
        ? { status: "saved", cause: "unavailable", offline: today.offline, problem: today.problem, retry: today.refetch }
        : { status: "loading" };
    }
    if (window === null) return { status: "saved", cause: "not-covered", offline: today.offline, problem: null, retry: today.refetch };
    // A crew's own alert has its hours from the crew's timeline, but what time it is comes from the forecast: until that has answered
    // the card is loading (or "unavailable" when it cannot), and never reads a made-up hour.
    if (clock === null) {
      return today.status === "error"
        ? { status: "saved", cause: "unavailable", offline: today.offline, problem: today.problem, retry: today.refetch }
        : { status: "loading" };
    }
    if (window.to !== null && clock.getTime() >= Date.parse(window.to)) return { status: "ended", endedAt: new Date(window.to) };

    const span = shiftSpan(timeline, zone);
    const forecast = view?.forecast ?? null;
    const personal = view?.personal;
    const personalLevel = personal?.status === "available" ? personal.value.level : null;
    const stale = forecast !== null && (forecast.forecast_status === "stale" || view?.freshness === "stale");
    // "Now" is drawn only when the window is on today's date at the site (a card opened the next day shows no now line).
    const nowHour = localDate(clock, zone) === localDate(new Date(window.from), zone) ? hourOfDay(clock, zone) : null;
    const startHour = hourOfDay(new Date(window.from), zone);
    // By instant, not by text: the window writes "...:00.000Z" and the API wrote "...:00Z" for the same hour.
    const startAt = forecast?.hours.find((hour) => Date.parse(hour.starts_at) === Date.parse(window.from));
    return {
      status: "ready",
      window,
      plan: actionPlan(startAt?.action_codes ?? []),
      cells: (forecast?.hours ?? []).map((hour) => ({ hour: Math.floor(hourOfDay(new Date(hour.starts_at), zone)), wbgtC: hour.wbgt_c.p50 })),
      from: span.from,
      to: span.to,
      changedFrom: startHour,
      changedTo: window.to === null ? null : hourOfDay(new Date(window.to), zone),
      nowHour,
      personalHigher: personalLevel !== null && levelIndex(personalLevel) > levelIndex(window.level) ? personalLevel : null,
      personalUnavailable:
        personal?.status === "unavailable" &&
        (personal.reason === "policy-unavailable" || personal.reason === "version-mismatch" || personal.reason === "not-computable"),
      forecast,
      synthetic: sites.find((site) => site.id === siteId)?.synthetic ?? null,
      stale,
      offline: today.offline,
      updatedAt: generatedAt,
      ageMs: generatedAt === null ? 0 : today.deviceNow.getTime() - generatedAt.getTime(),
    };
  }, [loaded, failedOrWaiting, window, clock, timeline, zone, view, sites, siteId, today, generatedAt]);
}

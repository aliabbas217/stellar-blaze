"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTimeZone } from "next-intl";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { crewTimelineQueryOptions } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import type { Problem } from "@/api/problem";
import type { components } from "@/api/schema";
import { useFieldCrewLabel } from "@/components/shell/FieldHeading";
import { DEMO_CREW_ID } from "@/features/demo/constants";
import { useDemo } from "@/features/demo/DemoProvider";
import { useClock } from "@/features/demo/useClock";
import { useProfile } from "@/features/profile/store";
import { useDeviceSite } from "@/features/profile/useDeviceSite";
import { useSiteContactsSync } from "@/features/profile/useSiteContactsSync";
import { describeToday, type TodayDescription } from "@/features/today/describe";
import { useSiteToday } from "@/features/today/useSiteToday";
import { useUrlParam } from "@/lib/url-state";

/*
 * Everything the Today screen needs, as one model (F2 Task 16). It extends F1's `useSiteToday` (forecast, policy, profile,
 * personal level) with the replay clock, the crew's timeline for the shift, and the site pin, and hands the view a union:
 * the view words each case and draws nothing it was not given.
 *
 * Which site: the one this phone is pinned to; `?site=` and `?crew=` pin it too (an e2e and a shared link use them), and the
 * demo yard is one tap (`demoYard`) for a visitor with no poster to scan. The crew's name goes to the header through the
 * shell's slot (`useFieldCrewLabel`), because the layout runs no query of its own.
 */

type Forecast = components["schemas"]["SiteForecastToday"];

export const SITE_PARAM = "site";
export const CREW_PARAM = "crew";

/** A non-empty id from the URL, or null. A stable reference: `useUrlParam` re-reads when its parser changes. */
function parseId(raw: string | null): string | null {
  return raw !== null && raw !== "" ? raw : null;
}

function subscribeNever(): () => void {
  return () => undefined;
}

export type TodayModel =
  /** Before the phone's own storage can be read (server render, hydration): a skeleton, never the "no site" screen. */
  | { readonly status: "starting" }
  | {
      readonly status: "no-site";
      readonly entry: "ready" | "loading" | "unavailable";
      /** Pins the phone to the demo site and its scored crew. */
      readonly demoYard: () => void;
      readonly retrySites: () => void;
    }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly problem: Problem; readonly retry: () => void }
  | {
      readonly status: "ready";
      readonly description: TodayDescription;
      readonly forecast: Forecast;
      /** `Site.synthetic` of the site on screen, or null while the site list has not said (no proof is built until it has). */
      readonly synthetic: boolean | null;
      /** No push registration on this phone: "Turn on warnings" is the one primary action. */
      readonly pushOff: boolean;
    };

export function useTodayModel(): TodayModel {
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [siteParam] = useUrlParam(SITE_PARAM, parseId, null);
  const [crewParam] = useUrlParam(CREW_PARAM, parseId, null);
  const pin = useDeviceSite();
  const { site: demoSite, sites, siteStatus } = useDemo();
  // The pinned site's call numbers go onto the phone, for the unwell sheet to use offline (features/profile/useSiteContactsSync.ts).
  useSiteContactsSync(sites);
  const queryClient = useQueryClient();
  const pushOff = useProfile((state) => state.push) === null;

  const siteId = siteParam ?? pin.siteId;
  const crewId = siteParam === null ? pin.crewId : crewParam;

  // `?site=` pins the phone (and `?crew=`, or none): the URL is how a link or an e2e chooses.
  const { choose } = pin;
  useEffect(() => {
    if (siteParam !== null && (pin.siteId !== siteParam || pin.crewId !== crewParam)) choose(siteParam, crewParam);
  }, [siteParam, crewParam, pin.siteId, pin.crewId, choose]);

  const clock = useClock();
  const enabled = hydrated && siteId !== null;
  const today = useSiteToday(siteId ?? "", { now: clock, enabled });
  const timeline = useQuery({ ...crewTimelineQueryOptions(crewId ?? ""), enabled: enabled && crewId !== null });
  const timelineData = timeline.data;
  useFieldCrewLabel(timelineData?.crew_name ?? null);

  const zone = useTimeZone() ?? "Asia/Dubai";
  const locale = useLocale();
  const view = today.view;
  const deviceNow = today.deviceNow;
  const offline = today.offline;
  const description = useMemo(
    () =>
      view === null ? null : describeToday({ view, timeline: timelineData ?? null, offline, now: clock, deviceNow, zone, locale }),
    [view, timelineData, offline, clock, deviceNow, zone, locale],
  );

  const demoYard = useCallback(() => {
    if (demoSite !== null) choose(demoSite.id, DEMO_CREW_ID);
  }, [demoSite, choose]);
  const retrySites = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sites() });
  }, [queryClient]);

  if (!hydrated) return { status: "starting" };
  if (siteId === null) {
    return { status: "no-site", entry: demoSite !== null ? "ready" : siteStatus === "loading" ? "loading" : "unavailable", demoYard, retrySites };
  }
  if (today.status === "error") return { status: "error", problem: today.problem, retry: today.refetch };
  if (description === null || view === null) return { status: "loading" };
  return {
    status: "ready",
    description,
    forecast: view.forecast,
    synthetic: sites.find((site) => site.id === siteId)?.synthetic ?? null,
    pushOff,
  };
}

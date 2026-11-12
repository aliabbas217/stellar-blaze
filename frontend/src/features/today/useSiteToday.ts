"use client";

import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiClient } from "@/api/client";
import { ApiProblem, type Problem } from "@/api/problem";
import { call } from "@/api/result";
import type { components } from "@/api/schema";
import type { Level } from "@/components/level/level";
import { isCalendarDate, localCalendarDate, type Profile } from "@/features/profile/profile-shape";
import { useProfile } from "@/features/profile/store";
import { displayedLevel, personalLevel, policyMatchesForecast, type PersonalLevel } from "@/features/risk/personal";
import { currentHour, freshness, type Freshness } from "@/features/today/freshness";

/*
 * The data behind the worker's Today screen, with no markup in it: the site's forecast and the risk policy through
 * TanStack Query, joined with the on-device profile and the clock into one view model.
 *
 * Fetching is client side and goes through the query library, never an effect: the service worker's NetworkFirst cache
 * (features/pwa) answers these two GETs when the phone is offline, which only a request made by the page can ask for.
 * `networkMode: "offlineFirst"` is what makes the page ask: the default ("online") holds a request back while the library
 * believes the device is offline, so the worker's cached copy would never be asked for. The first request is always made;
 * only its retries wait for a connection.
 *
 * Personal risk is worked out on the phone and never sent anywhere (ADR 0004). It needs a policy whose config_version
 * equals the forecast's (ADR 0010); until it does there is no personal level, only the site's. The versions are shown as
 * the API wrote them and never parsed.
 */

type HourForecast = components["schemas"]["HourForecast"];
type RiskPolicy = components["schemas"]["RiskPolicy"];
type SiteForecastToday = components["schemas"]["SiteForecastToday"];

// --- The two queries -------------------------------------------------------------------------------------------------

/** The query key of the risk policy, shared by everything on the device that needs it. */
export const RISK_POLICY_KEY = ["risk-policy"] as const;

/** The query key of a site's forecast for today. */
export function todayKey(siteId: string): readonly ["today", string] {
  return ["today", siteId];
}

/** The settled call, as openapi-fetch gives it. A failure is thrown as an `ApiProblem`, which keeps the request id. */
async function orThrow<T>(request: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const result = await call(request);
  if (!result.ok) throw new ApiProblem(result.problem);
  return result.data;
}

export function siteTodayQueryOptions(siteId: string) {
  return queryOptions<SiteForecastToday, ApiProblem>({
    queryKey: todayKey(siteId),
    networkMode: "offlineFirst",
    queryFn: ({ signal }) =>
      orThrow(apiClient.GET("/api/v1/sites/{site_id}/forecast/today", { params: { path: { site_id: siteId } }, signal })),
  });
}

export function riskPolicyQueryOptions() {
  return queryOptions<RiskPolicy, ApiProblem>({
    queryKey: RISK_POLICY_KEY,
    networkMode: "offlineFirst",
    queryFn: ({ signal }) => orThrow(apiClient.GET("/api/v1/risk-policy", { signal })),
  });
}

// --- The view model, a pure function of what the screen knows ----------------------------------------------------------

/**
 * Why there is no personal level, in the order the reasons are checked. Each is one line of copy for the screen; none is
 * an error: the site level is shown regardless.
 *
 *  - no-profile          nothing is set up on this phone.
 *  - outside-forecast    no hour of the forecast contains now (yesterday's forecast, or the day is over): review focus 3.
 *  - no-hour-data        the current hour has no WBGT numbers.
 *  - policy-unavailable  the policy is not loaded (loading, or it failed and none is cached).
 *  - version-mismatch    the policy's config_version is not the forecast's (ADR 0010).
 *  - not-computable      the policy and profile do not fit (an unknown workload or clothing code, a policy value that
 *                        cannot be used, no band for the probability, a stored start date that is not a date).
 */
export type PersonalUnavailableReason =
  | "no-profile"
  | "outside-forecast"
  | "no-hour-data"
  | "policy-unavailable"
  | "version-mismatch"
  | "not-computable";

export type PersonalStatus =
  | { readonly status: "available"; readonly value: PersonalLevel }
  | { readonly status: "unavailable"; readonly reason: PersonalUnavailableReason };

/** The level the screen leads with, and whose it is: `personal` when the worker's own is at least the site's. */
export interface DisplayedLevel {
  readonly level: Level;
  readonly source: "personal" | "site";
}

/** Both versions as the API wrote them: shown verbatim and compared only for equality, never parsed or ordered. */
export interface TodayVersions {
  readonly forecast: { readonly policyVersion: string; readonly configVersion: number };
  /** The policy the device holds, or null while it has none. */
  readonly policy: { readonly version: string; readonly configVersion: number } | null;
}

export interface TodayViewModel {
  /** The forecast itself: the hours for the band, `generated_at` for the banner. */
  readonly forecast: SiteForecastToday;
  readonly freshness: Freshness;
  /** The hour that contains now, or null when the forecast does not cover the present. */
  readonly currentHour: HourForecast | null;
  /** The site's level for the current hour, or null when there is no current hour or it has no data. */
  readonly siteLevel: Level | null;
  readonly personal: PersonalStatus;
  /** Null when there is no level of either kind to lead with. */
  readonly displayed: DisplayedLevel | null;
  readonly versions: TodayVersions;
  /** True when the policy is held and is not the forecast's: the policy should be fetched again (the hook does). */
  readonly needsPolicyRefetch: boolean;
}

function unavailable(reason: PersonalUnavailableReason): PersonalStatus {
  return { status: "unavailable", reason };
}

function personalFor(input: {
  forecast: SiteForecastToday;
  hour: HourForecast | null;
  policy: RiskPolicy | undefined;
  profile: Profile | null;
  now: Date;
}): PersonalStatus {
  const { forecast, hour, policy, profile, now } = input;
  if (profile === null) return unavailable("no-profile");
  if (hour === null) return unavailable("outside-forecast");
  const { p05, p50, p95 } = hour.wbgt_c;
  if (p05 === null || p50 === null || p95 === null) return unavailable("no-hour-data");
  if (policy === undefined) return unavailable("policy-unavailable");
  if (!policyMatchesForecast(forecast, policy)) return unavailable("version-mismatch");
  // personalLevel throws on a start date that is not a calendar date; the store validates it, and this keeps a bad
  // stored value from blanking the screen: the site level still shows.
  if (!isCalendarDate(profile.heatWorkStartDate)) return unavailable("not-computable");
  const value = personalLevel({ hour, profile, policy, today: localCalendarDate(now) });
  return value === null ? unavailable("not-computable") : { status: "available", value };
}

/**
 * What the Today screen is told, from the four things it knows. Pure and total: it never throws and reads no clock.
 *
 * "Now" must be covered: with no hour of the forecast containing it there is no site level and no personal level, however
 * fresh the forecast is. A stale forecast that does cover now still gives its levels; `freshness` is how the screen says
 * so. The level the screen leads with is the more severe of the site's and the worker's (`displayedLevel`), credited to the
 * worker's own when they are equal.
 */
export function selectTodayViewModel(input: {
  forecast: SiteForecastToday;
  policy: RiskPolicy | undefined;
  profile: Profile | null;
  now: Date;
}): TodayViewModel {
  const { forecast, policy, profile, now } = input;
  const hour = currentHour(forecast.hours, now);
  const siteLevel = hour?.site_level ?? null;
  const personal = personalFor({ forecast, hour, policy, profile, now });

  const personalOwn = personal.status === "available" ? personal.value.level : null;
  const level = displayedLevel(siteLevel, personalOwn);
  const displayed: DisplayedLevel | null = level === null ? null : { level, source: level === personalOwn ? "personal" : "site" };

  return {
    forecast,
    freshness: freshness(forecast.generated_at, now),
    currentHour: hour,
    siteLevel,
    personal,
    displayed,
    versions: {
      forecast: { policyVersion: forecast.policy_version, configVersion: forecast.config_version },
      policy: policy === undefined ? null : { version: policy.version, configVersion: policy.config_version },
    },
    needsPolicyRefetch: policy !== undefined && !policyMatchesForecast(forecast, policy),
  };
}

// --- The clock and the connection ------------------------------------------------------------------------------------

/**
 * How often the screen reads the clock again, so that the current hour and the freshness move on while the app stays
 * open. A minute is the finest time the screen shows. The clock is also read at once when the page is shown again, because
 * a phone that slept runs no timers.
 */
export const CLOCK_TICK_MS = 60_000;

/** The time now, read again every minute and whenever the page becomes visible. Exported for its test. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const read = () => {
      setNow(new Date());
    };
    const timer = setInterval(read, CLOCK_TICK_MS);
    document.addEventListener("visibilitychange", read);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, []);
  return now;
}

function subscribeToConnection(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Whether the browser says it has no connection. `navigator.onLine` is right when it says offline and only a guess when it
 * says online (a Wi-Fi with no internet reads as online), so this is a lower bound; `freshness` covers the rest. The query
 * library's own `onlineManager` assumes online until an event says otherwise, so a page opened offline would read as online.
 * On the server, and while hydrating, it reads as online.
 */
function useOffline(): boolean {
  return useSyncExternalStore(
    subscribeToConnection,
    () => !navigator.onLine,
    () => false,
  );
}

// --- The hook ---------------------------------------------------------------------------------------------------------

interface SiteTodayCommon {
  /** The browser says there is no connection: what is shown came from memory or the service worker's cache. */
  readonly offline: boolean;
  /** The forecast is being requested (the first time, or again after Retry or a refocus). */
  readonly fetching: boolean;
  /** Requests the forecast and the policy again. */
  readonly refetch: () => void;
}

/**
 * The screen's state:
 *  - loading: no forecast yet, and no failure; also while a retry after a failure is in flight (the failure is cleared).
 *  - error:   no forecast, and the request failed: `problem` has the request id for the error state.
 *  - ready:   a forecast exists, however old (the view says how old). `problem` is the last refresh that failed, if the
 *             latest one did: the forecast on screen is the earlier one, and `view.freshness` says whether it still counts.
 */
export type SiteToday =
  | (SiteTodayCommon & { readonly status: "loading"; readonly view: null; readonly problem: null })
  | (SiteTodayCommon & { readonly status: "error"; readonly view: null; readonly problem: Problem })
  | (SiteTodayCommon & { readonly status: "ready"; readonly view: TodayViewModel; readonly problem: Problem | null });

/**
 * Today's forecast for `siteId` (query key ["today", siteId]) and the risk policy (["risk-policy"]), with the worker's
 * on-device profile and the clock, as a `SiteToday`.
 *
 * When the policy is held and its config_version differs from the forecast's, the policy is fetched again (ADR 0010), once
 * for each pair of versions: if it still differs the screen keeps showing no personal level and both versions, and nothing
 * loops. The effect below only invalidates a cached query; the request itself is made by the query library.
 */
export function useSiteToday(siteId: string): SiteToday {
  const queryClient = useQueryClient();
  const forecastQuery = useQuery(siteTodayQueryOptions(siteId));
  const policyQuery = useQuery(riskPolicyQueryOptions());
  const profile = useProfile((state) => state.profile);
  const now = useNow();
  const offline = useOffline();

  const forecast = forecastQuery.data;
  const policy = policyQuery.data;
  const view = useMemo(
    () => (forecast === undefined ? null : selectTodayViewModel({ forecast, policy, profile, now })),
    [forecast, policy, profile, now],
  );

  const needsPolicyRefetch = view?.needsPolicyRefetch === true;
  const forecastConfigVersion = view?.versions.forecast.configVersion;
  const policyConfigVersion = view?.versions.policy?.configVersion;
  useEffect(() => {
    // Keyed on the pair of versions: a refetch that brings the same policy changes neither, so it is not asked again.
    // A request already in flight is left to finish rather than cancelled and restarted.
    if (needsPolicyRefetch) void queryClient.invalidateQueries({ queryKey: RISK_POLICY_KEY }, { cancelRefetch: false });
  }, [needsPolicyRefetch, forecastConfigVersion, policyConfigVersion, queryClient]);

  const { refetch: refetchForecast } = forecastQuery;
  const { refetch: refetchPolicy } = policyQuery;
  const refetch = useCallback(() => {
    void refetchForecast();
    void refetchPolicy();
  }, [refetchForecast, refetchPolicy]);

  const common: SiteTodayCommon = { offline, fetching: forecastQuery.isFetching, refetch };
  const problem = forecastQuery.error?.problem ?? null;
  if (view !== null) return { ...common, status: "ready", view, problem };
  if (problem !== null) return { ...common, status: "error", view: null, problem };
  return { ...common, status: "loading", view: null, problem: null };
}

"use client";

import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiClient } from "@/api/client";
import { ApiProblem, type Problem } from "@/api/problem";
import { call } from "@/api/result";
import type { components } from "@/api/schema";
import { levelIndex, type Level } from "@/components/level/level";
import { useHasProfile } from "@/features/profile/site-pin";
import { displayedLevel } from "@/features/risk/displayed-level";
import type { PersonalLevel } from "@/features/risk/personal";
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
 *
 * The personal part is INJECTED (F2 W1, the route script budget): this module holds the site's side only, with no profile
 * store and no risk code in it. A phone that holds a profile loads `personal-level.ts` (the store, NIOSH, the personal level)
 * after the first paint and hands `selectTodayViewModel` its pipeline; a phone with none never fetches it. The sign, the
 * spine and the lead are the site's and do not wait for it: the personal level can only raise the sign once it arrives.
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

/** What the on-device pipeline (personal-level.ts) says about one hour: injected into `selectTodayViewModel`. */
export interface PersonalPart {
  readonly personal: PersonalStatus;
  readonly policy: TodayVersions["policy"];
  /** True when the policy is held and is not the forecast's: the policy should be fetched again (the hook does). */
  readonly needsPolicyRefetch: boolean;
}

/** The pipeline itself, bound to the profile and the policy: the forecast, the hour that contains now (or null) and now, to its verdict. */
export type PersonalSource = (context: { hour: HourForecast | null; forecast: SiteForecastToday; now: Date }) => PersonalPart;

/** What a phone with no profile, or one whose on-device code has not loaded yet, has. */
export const NO_PERSONAL: PersonalPart = {
  personal: { status: "unavailable", reason: "no-profile" },
  policy: null,
  needsPolicyRefetch: false,
};

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

/**
 * What the Today screen is told, from what it knows. Pure and total: it never throws and reads no clock. `personal` is the
 * injected on-device pipeline, or null when there is none to run (no profile, or its code has not arrived).
 *
 * "Now" must be covered: with no hour of the forecast containing it there is no site level and no personal level, however
 * fresh the forecast is. A stale forecast that does cover now still gives its levels; `freshness` is how the screen says
 * so. The level the screen leads with is the more severe of the site's and the worker's (`displayedLevel`), credited to the
 * worker's own only when it is strictly the more severe: equal levels are the site's.
 */
export function selectTodayViewModel(input: { forecast: SiteForecastToday; now: Date; personal: PersonalSource | null }): TodayViewModel {
  const { forecast, now } = input;
  const hour = currentHour(forecast.hours, now);
  const siteLevel = hour?.site_level ?? null;
  const part = input.personal === null ? NO_PERSONAL : input.personal({ hour, forecast, now });

  const personalOwn = part.personal.status === "available" ? part.personal.value.level : null;
  const level = displayedLevel(siteLevel, personalOwn);
  // The worker's own is the source only when it is strictly the more severe (or the site has no level): at the same level the
  // site's warning stands and its run ("until 17:00") is known, where the worker's own run is not forecast.
  const ownLeads = personalOwn !== null && (siteLevel === null || levelIndex(personalOwn) > levelIndex(siteLevel));
  const displayed: DisplayedLevel | null = level === null ? null : { level, source: ownLeads ? "personal" : "site" };

  return {
    forecast,
    freshness: freshness(forecast.generated_at, now),
    currentHour: hour,
    siteLevel,
    personal: part.personal,
    displayed,
    versions: {
      forecast: { policyVersion: forecast.policy_version, configVersion: forecast.config_version },
      policy: part.policy,
    },
    needsPolicyRefetch: part.needsPolicyRefetch,
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

// --- The on-device pipeline, loaded on demand ---------------------------------------------------------------------------

type PersonalModule = typeof import("@/features/today/personal-level");

function subscribeNever(): () => void {
  return () => undefined;
}

function noProfile(): null {
  return null;
}

const COULD_NOT_LOAD: PersonalPart = { ...NO_PERSONAL, personal: { status: "unavailable", reason: "not-computable" } };

/**
 * The injected personal pipeline for a phone that holds a profile, or null: while the phone holds none and while the code
 * loads (a dynamic import started in an effect, so after the first paint). A load that failed is `not-computable` rather than
 * "no profile": the worker has a profile, and the screen says its level could not be worked out. The profile is read through
 * the loaded module's own subscription, so the store stays out of this one.
 */
function usePersonalSource(hasProfile: boolean, policy: RiskPolicy | undefined): PersonalSource | null {
  const [loaded, setLoaded] = useState<PersonalModule | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!hasProfile || loaded !== null || failed) return;
    let live = true;
    import("@/features/today/personal-level").then(
      (module_) => {
        if (live) setLoaded(module_);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [hasProfile, loaded, failed]);

  const profile = useSyncExternalStore(loaded?.subscribeProfile ?? subscribeNever, loaded?.getProfile ?? noProfile, noProfile);
  return useMemo((): PersonalSource | null => {
    if (!hasProfile) return null;
    if (loaded === null) return failed ? () => COULD_NOT_LOAD : null;
    return (context) => loaded.personalPartFor({ ...context, profile, policy });
  }, [hasProfile, loaded, failed, profile, policy]);
}

// --- The hook ---------------------------------------------------------------------------------------------------------

interface SiteTodayCommon {
  /** The browser says there is no connection: what is shown came from memory or the service worker's cache. */
  readonly offline: boolean;
  /** The forecast is being requested (the first time, or again after Retry or a refocus). */
  readonly fetching: boolean;
  /** Requests the forecast and the policy again. */
  readonly refetch: () => void;
  /** The phone's own clock, read every minute: how old a forecast is counts from it, even when `now` is the replay moment. */
  readonly deviceNow: Date;
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
 *
 * `options.now` is the instant the screen treats as now: the demo's replay clock (`useClock`) instead of the phone's. Which
 * hour is current, whether the forecast is fresh and whether a personal level may be shown all follow it; how long ago the
 * forecast was written (`deviceNow`) stays the phone's. `options.enabled: false` (no site chosen yet) makes no request.
 */
export function useSiteToday(siteId: string, options: { readonly now?: Date; readonly enabled?: boolean } = {}): SiteToday {
  const queryClient = useQueryClient();
  const enabled = options.enabled ?? true;
  const hasProfile = useHasProfile();
  const forecastQuery = useQuery({ ...siteTodayQueryOptions(siteId), enabled });
  // The policy is asked for only by a phone that holds a profile: nothing else needs it.
  const policyQuery = useQuery({ ...riskPolicyQueryOptions(), enabled: enabled && hasProfile });
  const personal = usePersonalSource(hasProfile, policyQuery.data);
  const deviceNow = useNow();
  const now = options.now ?? deviceNow;
  const offline = useOffline();

  const forecast = forecastQuery.data;
  const view = useMemo(() => (forecast === undefined ? null : selectTodayViewModel({ forecast, now, personal })), [forecast, personal, now]);

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

  const common: SiteTodayCommon = { offline, fetching: forecastQuery.isFetching, refetch, deviceNow };
  const problem = forecastQuery.error?.problem ?? null;
  if (view !== null) return { ...common, status: "ready", view, problem };
  if (problem !== null) return { ...common, status: "error", view: null, problem };
  return { ...common, status: "loading", view: null, problem: null };
}

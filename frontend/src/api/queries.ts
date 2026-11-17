import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { ApiProblem, networkProblem } from "@/api/problem";
import { queryKeys } from "@/api/query-keys";
import { call } from "@/api/result";
import { ROSTER_INVALID_TYPE, RosterInvalidProblem, rosterErrorsOf } from "@/api/roster-problem";
import type { components } from "@/api/schema";
import { trackSafetyFlight } from "@/lib/safety-flight";
import { stampArrival } from "@/lib/time/server-clock";

/*
 * Typed TanStack Query options for the F2 operations of the v1 contract (openapi/stellar-blaze.openapi.json), every
 * one through `call()` so a failure is an `ApiProblem` that keeps its request id.
 *
 * None of them sets `networkMode: "offlineFirst"`: that is for the two non-personal reads the service worker may
 * answer offline (forecast/today and risk-policy, in src/features/today/useSiteToday.ts). Everything here is either
 * employer-scoped (never cached, F2 decision D2) or needs the network by nature. The employer routes carry no
 * credential from the browser: the BFF adds the demo token on its allow-list (src/app/api/v1/[...path]/employer-auth.ts).
 *
 * The safety mutations (stop, clear stop, sign-off) set `networkMode: "always"`. With the default ("online") TanStack
 * Query pauses a mutation while it believes the device is offline and fires it on reconnect, which would show a stop as
 * pending, then send it minutes later: "never shown as delivered when it was not". With "always" the request is made
 * at once, fails at once offline, and the failure is an `ApiProblem` with status 0 that the screen words as "Not sent".
 */

type Schemas = components["schemas"];

/** Settles an openapi-fetch call, throwing the failure as an `ApiProblem`. */
export async function orThrow<T>(request: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const result = await call(request);
  if (!result.ok) throw new ApiProblem(result.problem);
  return result.data;
}

/** The `date` query: omitted when undefined, so the API's default date applies (exactOptionalPropertyTypes). */
function dateQuery(date: string | undefined): { date?: string } {
  return date === undefined ? {} : { date };
}

// --- Reads -----------------------------------------------------------------------------------------------------------------

/**
 * A site's forecast for today (a public read, no credential). The supervisor's crews read it for the replay stamp, the
 * freshness rule and the heat colour of each hour. The key is the one the worker's Today uses, so the demo clock
 * (`useClock`, which reads the newest forecast in the cache) works on every screen that holds it.
 */
export function siteForecastQueryOptions(siteId: string) {
  return queryOptions<Schemas["SiteForecastToday"], ApiProblem>({
    queryKey: queryKeys.today(siteId),
    // Not structurally shared: the sharing builds a copy of a response that changed, and the copy would lose its arrival stamp.
    structuralSharing: false,
    // Stamped on arrival: the response's `now` is the API's clock, which the app follows from that moment (useClock).
    queryFn: async ({ signal }) =>
      stampArrival(await orThrow(apiClient.GET("/api/v1/sites/{site_id}/forecast/today", { params: { path: { site_id: siteId } }, signal }))),
  });
}

/** The crews of a site with their stop and sign-off state for `date` (omitted: the API's default date). */
export function crewsQueryOptions(siteId: string, date?: string) {
  return queryOptions<Schemas["Crew"][], ApiProblem>({
    queryKey: queryKeys.crews(siteId, date),
    queryFn: ({ signal }) =>
      orThrow(apiClient.GET("/api/v1/sites/{site_id}/crews", { params: { path: { site_id: siteId }, query: dateQuery(date) }, signal })),
  });
}

export function crewTimelineQueryOptions(crewId: string, date?: string) {
  return queryOptions<Schemas["CrewTimeline"], ApiProblem>({
    queryKey: queryKeys.crewTimeline(crewId, date),
    queryFn: ({ signal }) =>
      orThrow(
        apiClient.GET("/api/v1/crews/{crew_id}/timeline", {
          params: { path: { crew_id: crewId }, query: dateQuery(date) },
          signal,
        }),
      ),
  });
}

export function crewDayPlanQueryOptions(crewId: string, date?: string) {
  return queryOptions<Schemas["DayPlan"], ApiProblem>({
    queryKey: queryKeys.crewDayPlan(crewId, date),
    queryFn: ({ signal }) =>
      orThrow(
        apiClient.GET("/api/v1/crews/{crew_id}/day-plan", {
          params: { path: { crew_id: crewId }, query: dateQuery(date) },
          signal,
        }),
      ),
  });
}

export function transparencyLogQueryOptions(siteId: string) {
  return queryOptions<Schemas["TransparencyLog"], ApiProblem>({
    queryKey: queryKeys.transparencyLog(siteId),
    queryFn: ({ signal }) =>
      orThrow(apiClient.GET("/api/v1/sites/{site_id}/transparency-log", { params: { path: { site_id: siteId } }, signal })),
  });
}

// --- Writes ----------------------------------------------------------------------------------------------------------------

/**
 * The independent validator's verdict on a roster. Violations are the ANSWER (a 200); a roster that does not parse is a 422
 * `roster-invalid` whose per-line `errors` the shared problem reader would drop, so it is thrown as a `RosterInvalidProblem`
 * (an `ApiProblem` that keeps them). Every other failure is a plain `ApiProblem`.
 */
export function validatePlanMutation() {
  return mutationOptions<Schemas["PlanValidateResponse"], ApiProblem, Schemas["PlanValidateRequest"]>({
    mutationFn: async (body) => {
      let raw: unknown;
      const result = await call(
        apiClient.POST("/api/v1/plans/validate", { body }).then((settled) => {
          raw = settled.error;
          return settled;
        }),
      );
      if (result.ok) return result.data;
      const errors = result.problem.status === 422 && result.problem.type === ROSTER_INVALID_TYPE ? rosterErrorsOf(raw) : null;
      throw errors === null ? new ApiProblem(result.problem) : new RosterInvalidProblem(result.problem, errors);
    },
  });
}

/**
 * The employer's request for one worker's data. The API always refuses it (403 individual-data-refused) and logs the
 * refusal, so this mutation always ends in an `ApiProblem`; the refusal is the screen's result, not a failure of it.
 * The log is refetched either way.
 */
export function dataRequestMutation(siteId: string) {
  return mutationOptions<never, ApiProblem, Schemas["DataRequestCreate"]>({
    mutationKey: ["data-request", siteId],
    // Offline, the call fails at once as a network problem ("Not sent") instead of pausing until the device is back.
    networkMode: "always",
    mutationFn: (body) => orThrow(apiClient.POST("/api/v1/sites/{site_id}/data-requests", { params: { path: { site_id: siteId } }, body })),
  });
}

/** Records a crew-lead stop. Stop work never waits for sign-off, so nothing here reads the day plan. */
export function stopMutation(crewId: string) {
  return mutationOptions<Schemas["CrewStop"], ApiProblem, Schemas["CrewStopCreate"]>({
    mutationKey: ["crew-stop", crewId],
    networkMode: "always",
    mutationFn: (body) => postStop(crewId, body),
  });
}

/**
 * How long a Stop request may take before the phone gives up on it (W5 I1: safety actions never wait). On a degraded or captive
 * connection a fetch can hang for minutes; after this the stop is treated like "no signal" (kept in the outbox, "Not sent. Tell the
 * crew now.") instead of leaving the bar on a spinner. A stop that did reach the server meanwhile is reconciled by the refetch.
 */
export const STOP_TIMEOUT_MS = 8_000;

/** Undo and resume (`DELETE`) get a longer bound: ending a stop is the opposite risk and should be given time to land, but never forever. */
export const CLEAR_STOP_TIMEOUT_MS = 15_000;

/** Whether `error` is a request that was aborted or timed out (`AbortSignal.timeout` rejects with a `TimeoutError`). */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError");
}

/**
 * `orThrow` for the safety writes: an abort or a timeout is the same as no answer at all (a status 0 `ApiProblem`, the offline path),
 * not the rethrown `AbortError` that `call()` keeps for cancelled queries. Nothing cancels these requests; only the clock does.
 */
async function orThrowBounded<T>(request: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  try {
    // Counted as in flight while it is on the wire: the service worker update check waits for it (features/pwa/safety-flight.ts).
    return await trackSafetyFlight(orThrow(request));
  } catch (error) {
    if (isAbort(error)) throw new ApiProblem(networkProblem());
    throw error;
  }
}

/** The stop request itself, for the mutation above and for the Stop outbox, which sends a stop pressed with no signal later. */
export function postStop(crewId: string, body: Schemas["CrewStopCreate"]): Promise<Schemas["CrewStop"]> {
  return orThrowBounded(
    apiClient.POST("/api/v1/crews/{crew_id}/stops", { params: { path: { crew_id: crewId } }, body, signal: AbortSignal.timeout(STOP_TIMEOUT_MS) }),
  );
}

/** Clears a stop: the 10 second undo, or the end of the stop. The variable is the stop id. */
export function clearStopMutation(crewId: string) {
  return mutationOptions<undefined, ApiProblem, string>({
    mutationKey: ["crew-stop-clear", crewId],
    networkMode: "always",
    mutationFn: (stopId) =>
      orThrowBounded(
        apiClient.DELETE("/api/v1/crews/{crew_id}/stops/{stop_id}", {
          params: { path: { crew_id: crewId, stop_id: stopId } },
          signal: AbortSignal.timeout(CLEAR_STOP_TIMEOUT_MS),
        }),
      ),
  });
}

/**
 * Signs the crew's day plan off (201 with the recorded sign-off). A 409 review-required is an `ApiProblem` with status
 * 409. `date` is the site-local date of the plan; omitted, the API's default date applies.
 */
export function signOffMutation(crewId: string, date?: string) {
  return mutationOptions<Schemas["PlanSignOff"], ApiProblem, Schemas["PlanSignOffRequest"]>({
    mutationKey: ["sign-off", crewId, date ?? null],
    networkMode: "always",
    mutationFn: (body) =>
      orThrow(
        apiClient.POST("/api/v1/crews/{crew_id}/day-plan/sign-off", {
          params: { path: { crew_id: crewId }, query: dateQuery(date) },
          body,
        }),
      ),
  });
}

/** Starts a new demo epoch for a synthetic site (candidate operation reset_demo_site, G1). */
export function resetDemoMutation(siteId: string) {
  return mutationOptions<Schemas["DemoReset"], ApiProblem>({
    mutationKey: ["demo-reset", siteId],
    mutationFn: () => orThrow(apiClient.POST("/api/v1/sites/{site_id}/demo-reset", { params: { path: { site_id: siteId } } })),
  });
}

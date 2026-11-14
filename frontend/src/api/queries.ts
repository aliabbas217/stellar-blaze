import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { ApiProblem } from "@/api/problem";
import { queryKeys } from "@/api/query-keys";
import { call } from "@/api/result";
import type { components } from "@/api/schema";

/*
 * Typed TanStack Query options for the F2 operations of the v1 contract (openapi/stellar-blaze.openapi.json), every
 * one through `call()` so a failure is an `ApiProblem` that keeps its request id.
 *
 * None of them sets `networkMode: "offlineFirst"`: that is for the two non-personal reads the service worker may
 * answer offline (forecast/today and risk-policy, in src/features/today/useSiteToday.ts). Everything here is either
 * employer-scoped (never cached, F2 decision D2) or needs the network by nature. The employer routes carry no
 * credential from the browser: the BFF adds the demo token on its allow-list (src/app/api/v1/[...path]/employer-auth.ts).
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

export function crewsQueryOptions(siteId: string) {
  return queryOptions<Schemas["Crew"][], ApiProblem>({
    queryKey: queryKeys.crews(siteId),
    queryFn: ({ signal }) => orThrow(apiClient.GET("/api/v1/sites/{site_id}/crews", { params: { path: { site_id: siteId } }, signal })),
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

export function validatePlanMutation() {
  return mutationOptions<Schemas["PlanValidateResponse"], ApiProblem, Schemas["PlanValidateRequest"]>({
    mutationFn: (body) => orThrow(apiClient.POST("/api/v1/plans/validate", { body })),
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
    mutationFn: (body) => orThrow(apiClient.POST("/api/v1/sites/{site_id}/data-requests", { params: { path: { site_id: siteId } }, body })),
  });
}

/** Records a crew-lead stop. Stop work never waits for sign-off, so nothing here reads the day plan. */
export function stopMutation(crewId: string) {
  return mutationOptions<Schemas["CrewStop"], ApiProblem, Schemas["CrewStopCreate"]>({
    mutationKey: ["crew-stop", crewId],
    mutationFn: (body) => orThrow(apiClient.POST("/api/v1/crews/{crew_id}/stops", { params: { path: { crew_id: crewId } }, body })),
  });
}

/** Clears a stop: the 10 second undo, or the end of the stop. The variable is the stop id. */
export function clearStopMutation(crewId: string) {
  return mutationOptions<undefined, ApiProblem, string>({
    mutationKey: ["crew-stop-clear", crewId],
    mutationFn: (stopId) =>
      orThrow(apiClient.DELETE("/api/v1/crews/{crew_id}/stops/{stop_id}", { params: { path: { crew_id: crewId, stop_id: stopId } } })),
  });
}

/** Signs the crew's day plan off. A 409 review-required is an `ApiProblem` with status 409. */
export function signOffMutation(crewId: string) {
  return mutationOptions<Schemas["DayPlan"], ApiProblem, Schemas["SignOffRequest"]>({
    mutationKey: ["sign-off", crewId],
    mutationFn: (body) =>
      orThrow(apiClient.POST("/api/v1/crews/{crew_id}/day-plan/sign-off", { params: { path: { crew_id: crewId } }, body })),
  });
}

/** Starts a new demo epoch for a synthetic site (candidate operation reset_demo_site, G1). */
export function resetDemoMutation(siteId: string) {
  return mutationOptions<Schemas["DemoReset"], ApiProblem>({
    mutationKey: ["demo-reset", siteId],
    mutationFn: () => orThrow(apiClient.POST("/api/v1/sites/{site_id}/demo-reset", { params: { path: { site_id: siteId } } })),
  });
}

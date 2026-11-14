import { http, HttpResponse, type HttpResponseResolver } from "msw/http";
import { z } from "zod";
import type { components } from "@/api/schema";
import { MOCK_SCENARIO_HEADER } from "../api/mock-scenario.ts";
import { problemResponse } from "../api/problem.ts";
import {
  REPLAY_DATE,
  STALE_AGE_MS,
  appendRefusal,
  clearStop,
  createStop,
  crewDayPlan,
  crewTimeline,
  crews,
  forecastToday,
  isIsoDate,
  resetDemoState,
  riskPolicy,
  signOffDayPlan,
  sites,
  transparencyLog,
  validateTyped,
  type DayOptions,
} from "./fixtures.ts";
import { parseRoster, ticksOfRoster } from "./rules.ts";

/*
 * MSW handlers for the whole contract in openapi/stellar-blaze.openapi.json: the 14 operations of ADR 0051 and its
 * amendment, plus the candidate `reset_demo_site`. The same handlers run in three places: Vitest (`setupServer`,
 * src/mocks/node.ts), the standalone mock server that e2e and `pnpm mock:api` use (@msw/serve, scripts/mock-api.ts),
 * and any test that overrides one with `server.use(...)`.
 *
 * Paths start with `*` so they match on any origin: the browser's own origin in jsdom, API_ORIGIN for the BFF
 * proxy and for server components, and the mock server's.
 *
 * Because e2e has no per-test `server.use`, every handler also honours the request header
 * `x-sb-mock-scenario`:
 *   error       a 500 problem+json whose request_id is "mock-req-1" (on writes too)
 *   stale       the forecast generated 26 hours ago, forecast_status "stale" (also on the day plan)
 *   empty       an empty result: `[]` for the lists, no hours for the forecast and the crew timeline, no segments for
 *               the day plan, no entries in the transparency log
 *   fallback    forecast_status "fallback": no hour has data or a level; the day plan is the protective fallback
 *   suppressed  every crew is below k: timelines say suppressed, day plans hide the restricted headcount
 * Any other value is ignored. The employer routes answer 401 without an `Authorization: Bearer` header (the BFF adds
 * the demo token on its allow-list); the mock accepts any non-empty token.
 *
 * Loaded by scripts/mock-api.ts under Node's type stripping: only `import type` uses the "@/" alias (it is
 * erased), runtime imports are relative and end in ".ts", and there are no enums or parameter properties.
 */

type Schemas = components["schemas"];
type Scenario = "error" | "stale" | "empty" | "fallback" | "suppressed";
type Info = Parameters<HttpResponseResolver>[0];

const MOCK_REQUEST_ID = "mock-req-1";

const FORECAST_PATH = "*/api/v1/sites/:site_id/forecast/today";

const PROBLEM_PREFIX = "urn:stellar-blaze:problem:";

const STATUS_TITLES: Record<number, string> = {
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Content",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

function mockProblem(status: number, detail?: string): Response {
  return problemResponse({
    type: `${PROBLEM_PREFIX}mock-${String(status)}`,
    title: STATUS_TITLES[status] ?? "Error",
    status,
    ...(detail === undefined ? {} : { detail }),
    request_id: MOCK_REQUEST_ID,
  });
}

/** A problem+json of a named type, with members beyond the base shape (`missing_items`, `errors`) where the contract has them. */
function namedProblem(
  status: number,
  type: string,
  detail: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  const body = {
    type: `${PROBLEM_PREFIX}${type}`,
    title: STATUS_TITLES[status] ?? "Error",
    status,
    detail,
    request_id: MOCK_REQUEST_ID,
    ...extra,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json", "x-request-id": MOCK_REQUEST_ID, ...headers },
  });
}

function scenarioOf(request: Request): Scenario | null {
  const value = request.headers.get(MOCK_SCENARIO_HEADER);
  return value === "error" || value === "stale" || value === "empty" || value === "fallback" || value === "suppressed" ? value : null;
}

function pathParam(params: Info["params"], name: string): string {
  const value = params[name];
  return typeof value === "string" ? value : "";
}

/** A resolver that answers the `error` scenario itself and hands every other request, and its scenario, on. */
function withScenario(
  resolve: (info: Info, scenario: Scenario | null) => Response | Promise<Response>,
): HttpResponseResolver {
  return (info) => {
    const scenario = scenarioOf(info.request);
    return scenario === "error" ? mockProblem(500) : resolve(info, scenario);
  };
}

/** The 401 an employer route gives a request with no bearer token. Any non-empty token passes in the mock. */
function unauthorized(request: Request): Response | null {
  const header = request.headers.get("authorization") ?? "";
  if (/^Bearer\s+\S+/.test(header)) return null;
  return namedProblem(401, "unauthorized", "An employer token is required.", {}, { "www-authenticate": "Bearer" });
}

function dayOptions(scenario: Scenario | null): DayOptions {
  return {
    ...(scenario === "fallback" ? { forecastStatus: "fallback" as const } : {}),
    ...(scenario === "stale" ? { forecastStatus: "stale" as const } : {}),
    ...(scenario === "suppressed" ? { forceSuppressed: true } : {}),
  };
}

/** The `date` query parameter: absent means the replay default date; present it must be a real YYYY-MM-DD date. */
function dateOf(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get("date");
  if (raw === null) return REPLAY_DATE;
  return isIsoDate(raw) ? raw : null;
}

const DATE_DETAIL = "date must be YYYY-MM-DD.";

function forecastResponse(siteId: string, date: string, scenario: Scenario | null): Response {
  const forecast = forecastToday(siteId, {
    date,
    ...(scenario === "stale" ? { ageMs: STALE_AGE_MS } : {}),
    ...(scenario === "fallback" ? { status: "fallback" as const } : {}),
  });
  if (forecast === undefined) return mockProblem(404, `No site ${siteId}.`);
  return HttpResponse.json(scenario === "empty" ? { ...forecast, hours: [] } : forecast);
}

async function jsonBody(request: Request): Promise<unknown> {
  return request.json().catch(() => undefined);
}

// strictObject mirrors `additionalProperties: false`: a client that sends anything beyond the contract (a worker
// field, say) gets a 422 here instead of passing silently.
const PushSubscriptionCreateSchema = z.strictObject({
  subscription: z.strictObject({
    endpoint: z.string(),
    expirationTime: z.number().nullable(),
    keys: z.strictObject({ p256dh: z.string(), auth: z.string() }),
  }),
  site_id: z.string(),
  crew_id: z.string().nullable(),
});

const DataRequestCreateSchema = z.strictObject({
  subject: z.literal("worker"),
  data_class: z.enum(["health", "personal", "exposure"]),
  worker_ref: z.string().min(1).max(100),
});

const CrewStopCreateSchema = z.strictObject({ reason_code: z.enum(["heat", "worker_unwell", "other"]) });

const SignOffRequestSchema = z.strictObject({
  acknowledged_items: z.array(z.string()),
  deviation_reason_code: z.string().nullable(),
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const PlanValidateRequestSchema = z.strictObject({
  site_id: z.string(),
  date: z.string(),
  crew: z.strictObject({
    workload: z.enum(["light", "moderate", "heavy"]),
    headcount: z.number().int().min(1).max(200),
    acclimatised: z.boolean().default(true),
    days_per_week: z.number().int().min(1).max(7).default(6),
  }),
  roster_text: z.string().max(2000).nullable().optional(),
  segments: z
    .array(z.strictObject({ start: z.string().regex(HHMM), end: z.string().regex(HHMM), state: z.enum(["work", "rest", "break"]) }))
    .nullable()
    .optional(),
});

export const handlers = [
  http.get(
    "*/api/v1/sites",
    withScenario((_info, scenario) => HttpResponse.json(scenario === "empty" ? [] : sites)),
  ),

  http.get(
    FORECAST_PATH,
    withScenario(({ request, params }, scenario) => {
      const date = dateOf(request);
      if (date === null) return mockProblem(422, DATE_DETAIL);
      return forecastResponse(pathParam(params, "site_id"), date, scenario);
    }),
  ),

  http.get(
    "*/api/v1/risk-policy",
    withScenario(() => HttpResponse.json(riskPolicy)),
  ),

  http.get(
    "*/api/v1/sites/:site_id/crews",
    withScenario(({ params }, scenario) => {
      const siteId = pathParam(params, "site_id");
      if (!sites.some((site) => site.id === siteId)) return mockProblem(404, `No site ${siteId}.`);
      const found: Schemas["Crew"][] = scenario === "empty" ? [] : crews.filter((crew) => crew.site_id === siteId);
      return HttpResponse.json(found);
    }),
  ),

  http.get(
    "*/api/v1/crews/:crew_id/timeline",
    withScenario(({ request, params }, scenario) => {
      const date = dateOf(request);
      if (date === null) return mockProblem(422, DATE_DETAIL);
      const crewId = pathParam(params, "crew_id");
      const timeline = crewTimeline(crewId, date, dayOptions(scenario));
      if (timeline === undefined) return mockProblem(404, `No crew ${crewId}.`);
      return HttpResponse.json(scenario === "empty" ? { ...timeline, hours: [] } : timeline);
    }),
  ),

  http.get(
    "*/api/v1/crews/:crew_id/day-plan",
    withScenario(({ request, params }, scenario) => {
      const refused = unauthorized(request);
      if (refused !== null) return refused;
      const date = dateOf(request);
      if (date === null) return mockProblem(422, DATE_DETAIL);
      const crewId = pathParam(params, "crew_id");
      const plan = crewDayPlan(crewId, date, dayOptions(scenario));
      if (plan === undefined) return mockProblem(404, `No crew ${crewId}.`);
      return HttpResponse.json(scenario === "empty" ? { ...plan, segments: [], zone_hours: [], ack_items: [] } : plan);
    }),
  ),

  http.post(
    "*/api/v1/crews/:crew_id/day-plan/sign-off",
    withScenario(async ({ request, params }, scenario) => {
      const refused = unauthorized(request);
      if (refused !== null) return refused;
      const crewId = pathParam(params, "crew_id");
      if (!crews.some((crew) => crew.id === crewId)) return mockProblem(404, `No crew ${crewId}.`);
      const parsed = SignOffRequestSchema.safeParse(await jsonBody(request));
      if (!parsed.success) return mockProblem(422, "Body is not a sign-off request.");
      const outcome = signOffDayPlan(crewId, parsed.data.acknowledged_items, dayOptions(scenario));
      if (outcome === undefined) return mockProblem(404, `No crew ${crewId}.`);
      if (outcome.kind === "unknown-items") return mockProblem(422, `Not items of this plan: ${outcome.unknown.join(", ")}.`);
      if (outcome.kind === "review-required") {
        return namedProblem(409, "review-required", "Every item that needs review must be acknowledged before sign-off.", {
          missing_items: outcome.missing,
        });
      }
      return HttpResponse.json(outcome.plan);
    }),
  ),

  http.post(
    "*/api/v1/plans/validate",
    withScenario(async ({ request }, scenario) => {
      const parsed = PlanValidateRequestSchema.safeParse(await jsonBody(request));
      if (!parsed.success) return mockProblem(422, "Body is not a plan validation request.");
      const { site_id: siteId, date, crew, roster_text: rosterText, segments } = parsed.data;
      if (!isIsoDate(date)) return mockProblem(422, DATE_DETAIL);
      if (!sites.some((site) => site.id === siteId)) return mockProblem(404, `No site ${siteId}.`);
      if ((rosterText == null) === (segments == null)) return mockProblem(422, "Send exactly one of roster_text and segments.");
      const text = rosterText ?? (segments ?? []).map((segment) => `${segment.start}-${segment.end} ${segment.state}`).join("\n");
      const roster = parseRoster(text);
      if ("errors" in roster) {
        return namedProblem(422, "roster-invalid", "The roster could not be read.", { errors: roster.errors });
      }
      const response = validateTyped(
        {
          date,
          workload: crew.workload,
          daysPerWeek: crew.days_per_week,
          segments: roster.segments,
          states: ticksOfRoster(roster.segments),
        },
        dayOptions(scenario),
      );
      return HttpResponse.json(response);
    }),
  ),

  http.post(
    "*/api/v1/push/subscriptions",
    withScenario(async ({ request }) => {
      const parsed = PushSubscriptionCreateSchema.safeParse(await jsonBody(request));
      if (!parsed.success) return mockProblem(422, "Body is not a push subscription request.");
      const { site_id: siteId, crew_id: crewId } = parsed.data;
      if (!sites.some((site) => site.id === siteId)) return mockProblem(404, `No site ${siteId}.`);
      if (crewId !== null && !crews.some((crew) => crew.id === crewId && crew.site_id === siteId)) {
        return mockProblem(404, `No crew ${crewId} at ${siteId}.`);
      }
      const created: Schemas["PushSubscriptionCreated"] = { id: "sub-mock-1" };
      return HttpResponse.json(created, { status: 201 });
    }),
  ),

  http.delete(
    "*/api/v1/push/subscriptions/:subscription_id",
    withScenario(() => new HttpResponse(null, { status: 204 })),
  ),

  http.post(
    "*/api/v1/sites/:site_id/data-requests",
    withScenario(async ({ request, params }) => {
      const refused = unauthorized(request);
      if (refused !== null) return refused;
      const siteId = pathParam(params, "site_id");
      if (!sites.some((site) => site.id === siteId)) return mockProblem(404, `No site ${siteId}.`);
      const parsed = DataRequestCreateSchema.safeParse(await jsonBody(request));
      if (!parsed.success) return mockProblem(422, "Body is not a data request.");
      // worker_ref is validated and dropped: never stored, logged or echoed (ADR 0054).
      appendRefusal(siteId);
      return namedProblem(
        403,
        "individual-data-refused",
        "Individual health data is not held by this service and is never released to an employer.",
      );
    }),
  ),

  http.get(
    "*/api/v1/sites/:site_id/transparency-log",
    withScenario(({ params }, scenario) => {
      const siteId = pathParam(params, "site_id");
      const found = transparencyLog(siteId);
      if (found === undefined) return mockProblem(404, `No site ${siteId}.`);
      return HttpResponse.json(scenario === "empty" ? { ...found, entries: [] } : found);
    }),
  ),

  http.post(
    "*/api/v1/crews/:crew_id/stops",
    withScenario(async ({ request, params }) => {
      const refused = unauthorized(request);
      if (refused !== null) return refused;
      const crewId = pathParam(params, "crew_id");
      if (!crews.some((crew) => crew.id === crewId)) return mockProblem(404, `No crew ${crewId}.`);
      const parsed = CrewStopCreateSchema.safeParse(await jsonBody(request));
      if (!parsed.success) return mockProblem(422, "Body is not a stop request.");
      // A stop never waits for anything: no sign-off, no validation, no forecast.
      return HttpResponse.json(createStop(crewId), { status: 201 });
    }),
  ),

  http.delete(
    "*/api/v1/crews/:crew_id/stops/:stop_id",
    withScenario(({ request, params }) => {
      const refused = unauthorized(request);
      if (refused !== null) return refused;
      const crewId = pathParam(params, "crew_id");
      if (!crews.some((crew) => crew.id === crewId)) return mockProblem(404, `No crew ${crewId}.`);
      clearStop(crewId, pathParam(params, "stop_id"));
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  http.post(
    "*/api/v1/sites/:site_id/demo-reset",
    withScenario(({ request, params }) => {
      const refused = unauthorized(request);
      if (refused !== null) return refused;
      const siteId = pathParam(params, "site_id");
      const site = sites.find((candidate) => candidate.id === siteId);
      if (site === undefined) return mockProblem(404, `No site ${siteId}.`);
      if (!site.synthetic) return mockProblem(403, "Only a synthetic demo site can be reset.");
      const reset: Schemas["DemoReset"] = { epoch: resetDemoState() };
      return HttpResponse.json(reset);
    }),
  ),
];

/** Prefixed with `*` when it is an absolute path, so it matches on any origin like the defaults above. */
function onAnyOrigin(path: string): string {
  return path.startsWith("/") ? `*${path}` : path;
}

/**
 * A one-shot override: the next request to `path` (any method; `:name` segments work) fails with a `status`
 * problem+json whose request_id is "mock-req-1", then the default handler answers again.
 * Use as `server.use(problemOnce("/api/v1/sites", 500))`.
 */
export function problemOnce(path: string, status: number) {
  return http.all(onAnyOrigin(path), () => mockProblem(status), { once: true });
}

/** An override that serves every site's forecast as generated 26 hours ago. */
export function staleToday() {
  return http.get(FORECAST_PATH, ({ request, params }) => {
    const date = dateOf(request) ?? REPLAY_DATE;
    return forecastResponse(pathParam(params, "site_id"), date, "stale");
  });
}

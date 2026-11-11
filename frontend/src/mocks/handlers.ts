import { http, HttpResponse, type HttpResponseResolver } from "msw/http";
import { z } from "zod";
import type { components } from "@/api/schema";
import { MOCK_SCENARIO_HEADER } from "../api/mock-scenario.ts";
import { problemResponse } from "../api/problem.ts";
import { STALE_AGE_MS, crewTimeline, crews, forecastToday, riskPolicy, sites } from "./fixtures.ts";

/*
 * MSW handlers for the whole contract in openapi/stellar-blaze.mock.openapi.json. The same handlers run in
 * three places: Vitest (`setupServer`, src/mocks/node.ts), the standalone mock server that e2e and `pnpm mock:api`
 * use (@msw/serve, scripts/mock-api.ts), and any test that overrides one with `server.use(...)`.
 *
 * Paths start with `*` so they match on any origin: the browser's own origin in jsdom, API_ORIGIN for the BFF
 * proxy and for server components, and the mock server's.
 *
 * Because e2e has no per-test `server.use`, every handler also honours the request header
 * `x-sb-mock-scenario`:
 *   error  a 500 problem+json whose request_id is "mock-req-1" (on writes too)
 *   stale  the forecast generated 26 hours ago (only the forecast has a stale form)
 *   empty  an empty result: `[]` for the lists, no hours for the forecast and the crew timeline
 * Any other value is ignored.
 *
 * Loaded by scripts/mock-api.ts under Node's type stripping: only `import type` uses the "@/" alias (it is
 * erased), runtime imports are relative and end in ".ts", and there are no enums or parameter properties.
 */

type Schemas = components["schemas"];
type Scenario = "error" | "stale" | "empty";
type Info = Parameters<HttpResponseResolver>[0];

const MOCK_REQUEST_ID = "mock-req-1";

const FORECAST_PATH = "*/api/v1/sites/:site_id/forecast/today";

const STATUS_TITLES: Record<number, string> = {
  404: "Not Found",
  422: "Unprocessable Content",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

function mockProblem(status: number, detail?: string): Response {
  return problemResponse({
    type: `urn:stellar-blaze:problem:mock-${String(status)}`,
    title: STATUS_TITLES[status] ?? "Error",
    status,
    ...(detail === undefined ? {} : { detail }),
    request_id: MOCK_REQUEST_ID,
  });
}

function scenarioOf(request: Request): Scenario | null {
  const value = request.headers.get(MOCK_SCENARIO_HEADER);
  return value === "error" || value === "stale" || value === "empty" ? value : null;
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

function forecastResponse(siteId: string, scenario: Scenario | null): Response {
  const forecast = forecastToday(siteId, scenario === "stale" ? { ageMs: STALE_AGE_MS } : {});
  if (forecast === undefined) return mockProblem(404, `No site ${siteId}.`);
  return HttpResponse.json(scenario === "empty" ? { ...forecast, hours: [] } : forecast);
}

/** A real calendar date written YYYY-MM-DD ("2026-13-45" is not one). */
function isIsoDate(value: string | null): value is string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  // Round-tripping catches a day that overflows its month ("2026-02-30" parses as 2 March).
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
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

export const handlers = [
  http.get(
    "*/api/v1/sites",
    withScenario((_info, scenario) => HttpResponse.json(scenario === "empty" ? [] : sites)),
  ),

  http.get(
    FORECAST_PATH,
    withScenario(({ params }, scenario) => forecastResponse(pathParam(params, "site_id"), scenario)),
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
      const date = new URL(request.url).searchParams.get("date");
      if (!isIsoDate(date)) return mockProblem(422, "date is required and must be YYYY-MM-DD.");
      const crewId = pathParam(params, "crew_id");
      const timeline = crewTimeline(crewId, date);
      if (timeline === undefined) return mockProblem(404, `No crew ${crewId}.`);
      return HttpResponse.json(scenario === "empty" ? { ...timeline, hours: [] } : timeline);
    }),
  ),

  http.post(
    "*/api/v1/push/subscriptions",
    withScenario(async ({ request }) => {
      const parsed = PushSubscriptionCreateSchema.safeParse(await request.json().catch(() => undefined));
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
  return http.get(FORECAST_PATH, ({ params }) => forecastResponse(pathParam(params, "site_id"), "stale"));
}

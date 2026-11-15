import { http, HttpResponse, type HttpResponseResolver } from "msw/http";
import { z } from "zod";
import type { components } from "@/api/schema";
import { MOCK_SCENARIO_HEADER } from "../api/mock-scenario.ts";
import {
  OFFSEASON_DATE,
  REPLAY_DATE,
  STALE_AGE_MS,
  appendRefusal,
  clearStop,
  createStop,
  crewDayPlan,
  crewExists,
  crewTimeline,
  forecastToday,
  isIsoDate,
  listCrews,
  listSites,
  parseRoster,
  resetDemoState,
  riskPolicy,
  SHIFT_VIOLATIONS,
  signOffDayPlan,
  sites,
  transparencyLog,
  validateTyped,
  type DayOptions,
} from "./fixtures.ts";

/*
 * MSW handlers for the whole contract in openapi/stellar-blaze.openapi.json (B3's v1): the 15 operations. The same
 * handlers run in three places: Vitest (`setupServer`, src/mocks/node.ts), the standalone mock server that e2e and
 * `pnpm mock:api` use (@msw/serve, scripts/mock-api.ts), and any test that overrides one with `server.use(...)`.
 * The answers are canned (src/mocks/fixtures.ts); there is no rule engine here.
 *
 * Paths start with `*` so they match on any origin: the browser's own origin in jsdom, API_ORIGIN for the BFF
 * proxy and for server components, and the mock server's.
 *
 * Because e2e has no per-test `server.use`, every handler also honours the request header
 * `x-sb-mock-scenario`:
 *   error       a 500 problem+json whose request_id is "mock-req-1" (on writes too)
 *   stale       the forecast generated 26 hours ago, forecast_status "stale"; the day plan is the protective fallback
 *   empty       an empty result: `[]` for the lists, no hours for the forecast and the crew timeline, no segments for
 *               the day plan, no entries in the transparency log
 *   fallback    forecast_status "fallback": no hour has data or a level; the day plan is the protective fallback
 *   suppressed  every crew is below k: timelines say suppressed, day plans hide the restricted headcount
 *   offseason   the forecast and the crew timeline default to 24 Sep 2026, after the ban season: no ban instants, no slot
 *   noshift     the crew timelines publish no shift for the day
 *   shift-not-legal  the day plan and the sign-off answer 422 `shift-not-legal`: the crew's published shift breaks a shift
 *               rule by itself, so no plan is served (violations in the problem body)
 *   plan-invalid the day plan answers 500 `plan-invalid`: the independent validator rejected the planner's own plan, so no plan is
 *               served (the contract's "validator-failed" state; every other operation is unaffected)
 *   unavailable the operations that list a 503 in the contract (every read of the day views, the day plan, the sign-off,
 *               the data request, plan validation) answer 503 `dependency-unavailable`
 * Any other value is ignored. The employer routes answer 401 without an `Authorization: Bearer` header (the BFF adds
 * the demo token on its allow-list); the mock accepts any non-empty token. It does not rate limit: the BFF does.
 *
 * Loaded by scripts/mock-api.ts under Node's type stripping: only `import type` uses the "@/" alias (it is
 * erased), runtime imports are relative and end in ".ts", and there are no enums or parameter properties.
 */

type Schemas = components["schemas"];
type Scenario = "error" | "stale" | "empty" | "fallback" | "suppressed" | "offseason" | "noshift" | "shift-not-legal" | "plan-invalid" | "unavailable";
type Info = Parameters<HttpResponseResolver>[0];

const MOCK_REQUEST_ID = "mock-req-1";

const FORECAST_PATH = "*/api/v1/sites/:site_id/forecast/today";

const PROBLEM_PREFIX = "urn:stellar-blaze:problem:";

/** The type and title the contract's own examples give each status (openapi/stellar-blaze.openapi.json). */
const PROBLEMS: Record<number, { type: string; title: string }> = {
  401: { type: `${PROBLEM_PREFIX}unauthorized`, title: "Unauthorized" },
  403: { type: `${PROBLEM_PREFIX}forbidden-employer`, title: "Forbidden" },
  404: { type: `${PROBLEM_PREFIX}not-found`, title: "Not found" },
  409: { type: `${PROBLEM_PREFIX}conflict`, title: "Conflict" },
  422: { type: "about:blank", title: "Unprocessable Entity" },
  429: { type: `${PROBLEM_PREFIX}rate-limited`, title: "Rate limited" },
  500: { type: `${PROBLEM_PREFIX}mock-500`, title: "Internal Server Error" },
  501: { type: `${PROBLEM_PREFIX}not-implemented`, title: "Not implemented" },
  502: { type: `${PROBLEM_PREFIX}mock-502`, title: "Bad Gateway" },
  503: { type: `${PROBLEM_PREFIX}mock-503`, title: "Service Unavailable" },
};

interface ProblemInit {
  status: number;
  type?: string;
  title?: string;
  detail?: string;
  /** Members beyond the base shape: `errors`, `missing_items`. */
  extra?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** A problem+json as the contract defines it: type, title, status, detail, instance (the path), request_id. */
function problem(request: Request, init: ProblemInit): Response {
  const known = PROBLEMS[init.status] ?? { type: `${PROBLEM_PREFIX}mock-${String(init.status)}`, title: "Error" };
  const body = {
    type: init.type ?? known.type,
    title: init.title ?? known.title,
    status: init.status,
    ...(init.detail === undefined ? {} : { detail: init.detail }),
    instance: new URL(request.url).pathname,
    request_id: MOCK_REQUEST_ID,
    ...init.extra,
  };
  return new Response(JSON.stringify(body), {
    status: init.status,
    headers: { "content-type": "application/problem+json", "x-request-id": MOCK_REQUEST_ID, ...init.headers },
  });
}

function mockProblem(request: Request, status: number, detail?: string): Response {
  return problem(request, { status, ...(detail === undefined ? {} : { detail }) });
}

type ValidationError = Schemas["ValidationErrorItem"];

function validationProblem(request: Request, errors: ValidationError[]): Response {
  return problem(request, { status: 422, detail: "Request validation failed", extra: { errors } });
}

/** The 422 for a body that failed the contract: one item per zod issue, located in the body. */
function bodyProblem(request: Request, error: z.ZodError): Response {
  const errors = error.issues.map((issue) => ({
    loc: ["body", ...issue.path.map((part) => (typeof part === "number" ? part : String(part)))],
    msg: issue.message,
    type: issue.code,
  }));
  return validationProblem(request, errors);
}

function scenarioOf(request: Request): Scenario | null {
  const value = request.headers.get(MOCK_SCENARIO_HEADER);
  return value === "error" ||
    value === "stale" ||
    value === "empty" ||
    value === "fallback" ||
    value === "suppressed" ||
    value === "offseason" ||
    value === "noshift" ||
    value === "shift-not-legal" ||
    value === "plan-invalid" ||
    value === "unavailable"
    ? value
    : null;
}

function pathParam(params: Info["params"], name: string): string {
  const value = params[name];
  return typeof value === "string" ? value : "";
}

/** The 503 of an operation whose dependency (the database, the active configuration) is down; B3's contract example adds `dependency`. */
function unavailableProblem(request: Request): Response {
  return problem(request, {
    status: 503,
    type: `${PROBLEM_PREFIX}dependency-unavailable`,
    title: "Dependency unavailable",
    detail: "The active configuration is not loaded.",
    extra: { dependency: "config" },
  });
}

/**
 * A resolver that answers the `error` scenario itself and hands every other request, and its scenario, on. An
 * operation that lists a 503 in the contract passes `lists503`, so the `unavailable` scenario answers it too.
 */
function withScenario(
  resolve: (info: Info, scenario: Scenario | null) => Response | Promise<Response>,
  { lists503 = false }: { lists503?: boolean } = {},
): HttpResponseResolver {
  return (info) => {
    const scenario = scenarioOf(info.request);
    if (scenario === "error") return mockProblem(info.request, 500);
    if (scenario === "unavailable" && lists503) return unavailableProblem(info.request);
    return resolve(info, scenario);
  };
}

/** The 422 of `get_crew_day_plan` and `sign_off_day_plan` for a shift that is not legal by itself (the `shift-not-legal` scenario). */
function shiftNotLegalProblem(request: Request): Response {
  return problem(request, {
    status: 422,
    type: `${PROBLEM_PREFIX}shift-not-legal`,
    title: "Shift not legal",
    detail: "The published shift breaks a shift rule by itself; no plan can fix it.",
    extra: { violations: SHIFT_VIOLATIONS },
  });
}

/** The 500 of `get_crew_day_plan` when the independent validator rejected the planner's own plan (the `plan-invalid` scenario). */
function planInvalidProblem(request: Request): Response {
  return problem(request, {
    status: 500,
    type: `${PROBLEM_PREFIX}plan-invalid`,
    title: "Plan invalid",
    detail: "The independent validator rejected the planner's own plan; it is not served.",
  });
}

/** The 401 an employer route gives a request with no bearer token. Any non-empty token passes in the mock. */
function unauthorized(request: Request): Response | null {
  const header = request.headers.get("authorization") ?? "";
  if (/^Bearer\s+\S+/.test(header)) return null;
  return problem(request, { status: 401, detail: "A bearer token is required.", headers: { "www-authenticate": "Bearer" } });
}

function dayOptions(scenario: Scenario | null): DayOptions {
  return {
    ...(scenario === "fallback" ? { forecastStatus: "fallback" as const } : {}),
    ...(scenario === "stale" ? { forecastStatus: "stale" as const } : {}),
    ...(scenario === "suppressed" ? { forceSuppressed: true } : {}),
    ...(scenario === "noshift" ? { noShift: true } : {}),
  };
}

/**
 * The `date` query parameter: absent means the default date (the replay day, or a day after the ban season in the
 * `offseason` scenario); present it must be a real YYYY-MM-DD date.
 */
function dateOf(request: Request, scenario: Scenario | null = null): string | null {
  const raw = new URL(request.url).searchParams.get("date");
  if (raw === null) return scenario === "offseason" ? OFFSEASON_DATE : REPLAY_DATE;
  return isIsoDate(raw) ? raw : null;
}

function badDate(request: Request): Response {
  return validationProblem(request, [{ loc: ["query", "date"], msg: "Input should be a valid date", type: "date_parsing" }]);
}

function forecastResponse(request: Request, siteId: string, date: string, scenario: Scenario | null): Response {
  const forecast = forecastToday(siteId, {
    date,
    ...(scenario === "stale" ? { ageMs: STALE_AGE_MS } : {}),
    ...(scenario === "fallback" ? { status: "fallback" as const } : {}),
  });
  if (forecast === undefined) return mockProblem(request, 404, `No site ${siteId}.`);
  return HttpResponse.json(scenario === "empty" ? { ...forecast, hours: [] } : forecast);
}

async function jsonBody(request: Request): Promise<unknown> {
  return request.json().catch(() => undefined);
}

// strictObject mirrors `additionalProperties: false`: a client that sends anything beyond the contract (a worker
// field, say) gets a 422 here instead of passing silently.
const PushSubscriptionCreateSchema = z.strictObject({
  subscription: z.strictObject({
    // B3 refuses anything but an https URL (its 422: "endpoint must be an https URL").
    endpoint: z.string().startsWith("https://"),
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

const PlanSignOffRequestSchema = z.strictObject({
  acknowledged_items: z.array(z.string().min(1)).max(32),
  deviation_reason_code: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/)
    .nullable()
    .optional(),
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const PlanValidateRequestSchema = z.strictObject({
  site_id: z.string().min(1).max(100),
  date: z.string(),
  crew: z.strictObject({
    workload: z.enum(["light", "moderate", "heavy"]),
    headcount: z.number().int().min(1).max(200),
    acclimatised: z.boolean().optional(),
    days_per_week: z.number().int().min(1).max(7).optional(),
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
    withScenario((_info, scenario) => HttpResponse.json(scenario === "empty" ? [] : listSites())),
  ),

  http.get(
    FORECAST_PATH,
    withScenario(({ request, params }, scenario) => {
      const date = dateOf(request, scenario);
      if (date === null) return badDate(request);
      return forecastResponse(request, pathParam(params, "site_id"), date, scenario);
    }, { lists503: true }),
  ),

  http.get(
    "*/api/v1/risk-policy",
    withScenario(() => HttpResponse.json(riskPolicy), { lists503: true }),
  ),

  http.get(
    "*/api/v1/sites/:site_id/crews",
    withScenario(({ request, params }, scenario) => {
      if (dateOf(request) === null) return badDate(request);
      const siteId = pathParam(params, "site_id");
      const found = listCrews(siteId, dayOptions(scenario));
      if (found === undefined) return mockProblem(request, 404, `No site ${siteId}.`);
      return HttpResponse.json(scenario === "empty" ? [] : found);
    }, { lists503: true }),
  ),

  http.get(
    "*/api/v1/crews/:crew_id/timeline",
    withScenario(({ request, params }, scenario) => {
      const date = dateOf(request, scenario);
      if (date === null) return badDate(request);
      const crewId = pathParam(params, "crew_id");
      const timeline = crewTimeline(crewId, date, dayOptions(scenario));
      if (timeline === undefined) return mockProblem(request, 404, `No crew ${crewId}.`);
      return HttpResponse.json(scenario === "empty" ? { ...timeline, hours: [] } : timeline);
    }, { lists503: true }),
  ),

  http.get(
    "*/api/v1/crews/:crew_id/day-plan",
    withScenario(({ request, params }, scenario) => {
      const refused = unauthorized(request);
      if (refused !== null) return refused;
      const date = dateOf(request);
      if (date === null) return badDate(request);
      const crewId = pathParam(params, "crew_id");
      if (scenario === "shift-not-legal" && crewExists(crewId)) return shiftNotLegalProblem(request);
      if (scenario === "plan-invalid" && crewExists(crewId)) return planInvalidProblem(request);
      const plan = crewDayPlan(crewId, date, dayOptions(scenario));
      if (plan === undefined) return mockProblem(request, 404, `No crew ${crewId}.`);
      return HttpResponse.json(scenario === "empty" ? { ...plan, segments: [], zone_hours: [], ack_items: [] } : plan);
    }, { lists503: true }),
  ),

  http.post(
    "*/api/v1/crews/:crew_id/day-plan/sign-off",
    withScenario(async ({ request, params }, scenario) => {
      const refused = unauthorized(request);
      if (refused !== null) return refused;
      const crewId = pathParam(params, "crew_id");
      if (!crewExists(crewId)) return mockProblem(request, 404, `No crew ${crewId}.`);
      const date = dateOf(request);
      if (date === null) return badDate(request);
      if (scenario === "shift-not-legal") return shiftNotLegalProblem(request);
      const parsed = PlanSignOffRequestSchema.safeParse(await jsonBody(request));
      if (!parsed.success) return bodyProblem(request, parsed.error);
      const outcome = signOffDayPlan(crewId, parsed.data.acknowledged_items, parsed.data.deviation_reason_code ?? null, dayOptions(scenario), date);
      if (outcome === undefined) return mockProblem(request, 404, `No crew ${crewId}.`);
      if (outcome.kind === "unknown-items") {
        return validationProblem(
          request,
          outcome.unknown.map(({ id, index }) => ({ loc: ["body", "acknowledged_items", index], msg: `${id} is not an item of this plan`, type: "value_error" })),
        );
      }
      if (outcome.kind === "review-required") {
        return problem(request, {
          status: 409,
          type: `${PROBLEM_PREFIX}review-required`,
          title: "Review required",
          detail: "Every Medium and High item must be acknowledged before signing.",
          extra: { missing_items: outcome.missing },
        });
      }
      return HttpResponse.json(outcome.signOff, { status: 201 });
    }, { lists503: true }),
  ),

  http.post(
    "*/api/v1/plans/validate",
    withScenario(async ({ request }, scenario) => {
      const parsed = PlanValidateRequestSchema.safeParse(await jsonBody(request));
      if (!parsed.success) return bodyProblem(request, parsed.error);
      const { site_id: siteId, date, roster_text: rosterText, segments } = parsed.data;
      if (!isIsoDate(date)) return validationProblem(request, [{ loc: ["body", "date"], msg: "Input should be a valid date", type: "date_parsing" }]);
      if (!sites.some((site) => site.id === siteId)) return mockProblem(request, 404, `No site ${siteId}.`);
      if ((rosterText == null) === (segments == null)) {
        return validationProblem(request, [{ loc: ["body"], msg: "Send exactly one of roster_text and segments", type: "value_error" }]);
      }
      const text = rosterText ?? (segments ?? []).map((segment) => `${segment.start}-${segment.end} ${segment.state}`).join("\n");
      const roster = parseRoster(text);
      if ("errors" in roster) {
        return problem(request, {
          status: 422,
          type: `${PROBLEM_PREFIX}roster-invalid`,
          title: "Roster invalid",
          detail: "The roster could not be read.",
          extra: { errors: roster.errors },
        });
      }
      return HttpResponse.json(validateTyped({ date, segments: roster.segments }, dayOptions(scenario)));
    }, { lists503: true }),
  ),

  http.post(
    "*/api/v1/push/subscriptions",
    withScenario(async ({ request }) => {
      const parsed = PushSubscriptionCreateSchema.safeParse(await jsonBody(request));
      if (!parsed.success) return bodyProblem(request, parsed.error);
      const { site_id: siteId, crew_id: crewId } = parsed.data;
      if (!sites.some((site) => site.id === siteId)) return mockProblem(request, 404, `No site ${siteId}.`);
      if (crewId !== null && !(listCrews(siteId)?.some((crew) => crew.id === crewId) ?? false)) {
        return mockProblem(request, 404, `No crew ${crewId} at ${siteId}.`);
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
      if (!sites.some((site) => site.id === siteId)) return mockProblem(request, 404, `No site ${siteId}.`);
      const parsed = DataRequestCreateSchema.safeParse(await jsonBody(request));
      if (!parsed.success) return bodyProblem(request, parsed.error);
      // worker_ref is validated and dropped: never stored, logged or echoed (ADR 0054).
      appendRefusal(siteId);
      return problem(request, {
        status: 403,
        type: `${PROBLEM_PREFIX}individual-data-refused`,
        title: "Individual data refused",
        detail: "Individual health data is not held by this service and is never released to an employer (ADR 0004).",
      });
    }, { lists503: true }),
  ),

  http.get(
    "*/api/v1/sites/:site_id/transparency-log",
    withScenario(({ request, params }, scenario) => {
      const siteId = pathParam(params, "site_id");
      const found = transparencyLog(siteId);
      if (found === undefined) return mockProblem(request, 404, `No site ${siteId}.`);
      return HttpResponse.json(scenario === "empty" ? { ...found, entries: [] } : found);
    }),
  ),

  http.post(
    "*/api/v1/crews/:crew_id/stops",
    withScenario(async ({ request, params }) => {
      const refused = unauthorized(request);
      if (refused !== null) return refused;
      const crewId = pathParam(params, "crew_id");
      if (!crewExists(crewId)) return mockProblem(request, 404, `No crew ${crewId}.`);
      const parsed = CrewStopCreateSchema.safeParse(await jsonBody(request));
      if (!parsed.success) return bodyProblem(request, parsed.error);
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
      if (!crewExists(crewId)) return mockProblem(request, 404, `No crew ${crewId}.`);
      const stopId = pathParam(params, "stop_id");
      if (!clearStop(crewId, stopId)) return mockProblem(request, 404, `No stop ${stopId} on crew ${crewId}.`);
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
      if (site === undefined) return mockProblem(request, 404, `No site ${siteId}.`);
      if (!site.synthetic) {
        return problem(request, { status: 409, type: `${PROBLEM_PREFIX}not-a-demo-site`, title: "Not a demo site", detail: `Site ${siteId} is not synthetic.` });
      }
      return HttpResponse.json(resetDemoState(siteId));
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
  return http.all(onAnyOrigin(path), ({ request }) => mockProblem(request, status), { once: true });
}

/** An override that serves every site's forecast as generated 26 hours ago. */
export function staleToday() {
  return http.get(FORECAST_PATH, ({ request, params }) => {
    const date = dateOf(request) ?? REPLAY_DATE;
    return forecastResponse(request, pathParam(params, "site_id"), date, "stale");
  });
}

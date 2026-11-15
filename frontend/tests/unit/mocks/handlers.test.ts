// @vitest-environment node
import { http, HttpResponse } from "msw/http";
import type { components } from "@/api/schema";
import { ProblemSchema } from "@/api/problem-schema";
import { resetDemoStateHard } from "@/mocks/fixtures";
import { problemOnce, staleToday } from "@/mocks/handlers";
import { server } from "@/mocks/node";

/*
 * The fixtures and handlers are the contract the later tasks build and test against (unit tests, and e2e through
 * the standalone mock server), so the values other tasks rely on are pinned here: one case per operation of B3's v1
 * contract (openapi/stellar-blaze.openapi.json), typed from the generated schema. The answers are canned.
 */

type Schemas = components["schemas"];

const ORIGIN = "http://mock.test";
const DEMO_SITE = "site-demo-mussafah";
const EMPTY_SITE = "site-demo-empty";
const HOUR_MS = 3_600_000;
const REPLAY_DATE = "2026-09-03";
const EMPLOYER = { authorization: "Bearer demo-token" };
const PROBLEM_TYPE = "urn:stellar-blaze:problem:";

async function get(path: string, scenario?: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${ORIGIN}${path}`, { headers: { ...headers, ...(scenario === undefined ? {} : { "x-sb-mock-scenario": scenario }) } });
}

async function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function forecast(siteId = DEMO_SITE, scenario?: string, query = ""): Promise<Schemas["SiteForecastToday"]> {
  return json(await get(`/api/v1/sites/${siteId}/forecast/today${query}`, scenario));
}

async function timeline(crewId: string, query = "", scenario?: string): Promise<Schemas["CrewTimeline"]> {
  return json(await get(`/api/v1/crews/${crewId}/timeline${query}`, scenario));
}

async function dayPlan(crewId: string, query = "", scenario?: string): Promise<Schemas["DayPlan"]> {
  return json(await get(`/api/v1/crews/${crewId}/day-plan${query}`, scenario, EMPLOYER));
}

async function crewList(scenario?: string): Promise<Schemas["Crew"][]> {
  return json(await get(`/api/v1/sites/${DEMO_SITE}/crews`, scenario));
}

/** The local hour of an instant at Asia/Dubai (UTC+4, no daylight saving), as "HH:00". */
function dubaiHour(startsAt: string): string {
  const hour = (new Date(startsAt).getUTCHours() + 4) % 24;
  return `${String(hour).padStart(2, "0")}:00`;
}

function hourAt<T extends { starts_at: string }>(hours: T[], local: string): T | undefined {
  return hours.find((hour) => dubaiHour(hour.starts_at) === local);
}

beforeEach(() => {
  resetDemoStateHard();
});

describe("every problem", () => {
  it("has the contract's members: type, title, status, instance (the path) and request_id", async () => {
    const res = await get("/api/v1/sites/nope/crews?date=2026-09-03");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toEqual({
      type: `${PROBLEM_TYPE}not-found`,
      title: "Not found",
      status: 404,
      detail: "No site nope.",
      instance: "/api/v1/sites/nope/crews",
      request_id: "mock-req-1",
    });
  });

  it("lists validation errors by location for a bad query parameter", async () => {
    const res = await get(`/api/v1/sites/${DEMO_SITE}/forecast/today?date=2026-02-30`);

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      type: "about:blank",
      status: 422,
      errors: [{ loc: ["query", "date"], msg: "Input should be a valid date", type: "date_parsing" }],
    });
  });
});

describe("list_sites", () => {
  it("returns the two synthetic demo yards in Asia/Dubai: epoch 1, SYNTHETIC phones on the demo yard only", async () => {
    const res = await get("/api/v1/sites");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        id: "site-demo-mussafah",
        name: "Mussafah M-14 yard (synthetic)",
        timezone: "Asia/Dubai",
        synthetic: true,
        epoch_id: 1,
        supervisor_phone: "+12025550143",
        first_aider_phone: "+12025550144",
      },
      { id: "site-demo-empty", name: "Demo yard B (synthetic, no crews)", timezone: "Asia/Dubai", synthetic: true, epoch_id: 1, supervisor_phone: null, first_aider_phone: null },
    ]);
  });
});

describe("get_site_forecast_today", () => {
  it("covers 06:00 to 19:00 local on the replay day 2026-09-03, 14 hours, replay mode, model mock", async () => {
    const today = await forecast();

    expect(today).toMatchObject({
      site_id: DEMO_SITE,
      date: REPLAY_DATE,
      policy_version: "mock-0",
      config_version: 1,
      mode: "replay",
      forecast_status: "fresh",
      model_id: "mock",
      lead_days: 1,
    });
    expect(today.hours).toHaveLength(14);
    expect(dubaiHour(today.hours[0]?.starts_at ?? "")).toBe("06:00");
    expect(dubaiHour(today.hours.at(-1)?.starts_at ?? "")).toBe("19:00");
    expect(today.hours[0]?.starts_at).toBe("2026-09-03T02:00:00Z");
    const times = today.hours.map((hour) => new Date(hour.starts_at).getTime());
    expect(times.every((time, index) => index === 0 || time - (times[index - 1] ?? 0) === HOUR_MS)).toBe(true);
  });

  it("carries the REAL OMAA IFS day-1 WBGT numbers and the placeholder levels", async () => {
    const { hours } = await forecast();
    const level = (local: string) => hourAt(hours, local)?.site_level;

    expect(hourAt(hours, "11:00")?.wbgt_c.p50).toBe(35.4);
    expect(hourAt(hours, "14:00")?.wbgt_c.p50).toBe(39.4);
    expect(hourAt(hours, "14:00")?.wbgt_c.p05).toBeCloseTo(37.4);
    expect(hourAt(hours, "14:00")?.wbgt_c.p95).toBeCloseTo(41.4);
    expect(["06:00", "08:00", "10:00", "14:00", "15:00", "18:00"].map(level)).toEqual(["green", "amber", "orange", "red", "orange", "amber"]);
    expect(hours.every((hour) => hour.site_level !== null)).toBe(true);
  });

  it("carries placeholder action codes by level (the shapes the ruleset's plan names), none for a green hour", async () => {
    const { hours } = await forecast();
    const codes = (local: string) => hourAt(hours, local)?.action_codes;

    expect(codes("06:00")).toEqual([]);
    expect(codes("08:00")).toEqual(["cycle.medium.heavy.45-15", "fluids.over-1.2l"]);
    expect(codes("11:00")).toEqual(["cycle.high.heavy.20-40", "fluids.over-1.2l", "no-lone-work"]);
    expect(codes("14:00")).toEqual(["stop-work", "fluids.over-1.2l", "no-lone-work"]);
  });

  it("offseason scenario: defaults to a day after the ban season, with no ban instants and no ban hour; an explicit date still wins", async () => {
    const day = await forecast(DEMO_SITE, "offseason");

    expect(day.date).toBe("2026-09-24");
    expect(day.ban_window.active_on_date).toBe(false);
    expect(day.ban_window.starts_at).toBeNull();
    expect(day.hours.some((hour) => hour.ban_active)).toBe(false);
    expect((await forecast(DEMO_SITE, "offseason", "?date=2026-09-03")).date).toBe(REPLAY_DATE);
  });

  it("gives the ban window as an object: 12:30 to 15:00 local, the season, and UTC instants in force", async () => {
    const today = await forecast();

    expect(today.ban_window).toEqual({
      start: "12:30",
      end: "15:00",
      season_start: "06-15",
      season_end: "09-15",
      timezone: "Asia/Dubai",
      active_on_date: true,
      starts_at: "2026-09-03T08:30:00Z",
      ends_at: "2026-09-03T11:00:00Z",
    });
    const banned = today.hours.filter((hour) => hour.ban_active).map((hour) => dubaiHour(hour.starts_at));
    expect(banned).toEqual(["12:00", "13:00", "14:00"]);
  });

  it.each([
    ["the day before the season", "2026-06-14", false],
    ["the first day of the season", "2026-06-15", true],
    ["the last day of the season", "2026-09-15", true],
    ["the day after the season", "2026-09-16", false],
    ["a November date", "2026-11-11", false],
  ])("ban_window on %s", async (_name, date, active) => {
    const today = await forecast(DEMO_SITE, undefined, `?date=${date}`);

    expect(today.date).toBe(date);
    expect(today.ban_window).toMatchObject({ start: "12:30", end: "15:00", active_on_date: active });
    expect(today.ban_window.starts_at === null).toBe(!active);
    expect(today.ban_window.ends_at === null).toBe(!active);
    if (active) expect(today.ban_window.starts_at).toBe(`${date}T08:30:00Z`);
    expect(today.hours.some((hour) => hour.ban_active)).toBe(active);
  });

  it("is fresh by default and 26 hours old, stale, for the stale scenario", async () => {
    const age = (generatedAt: string) => Date.now() - new Date(generatedAt).getTime();
    const stale = await forecast(DEMO_SITE, "stale");

    expect(age((await forecast()).generated_at)).toBeLessThan(HOUR_MS);
    expect(age(stale.generated_at)).toBeGreaterThanOrEqual(26 * HOUR_MS);
    expect(age(stale.generated_at)).toBeLessThan(27 * HOUR_MS);
    expect(stale.forecast_status).toBe("stale");
  });

  it("answers the fallback scenario with no data and no level in any hour", async () => {
    const today = await forecast(DEMO_SITE, "fallback");

    expect(today.forecast_status).toBe("fallback");
    expect(today.hours).toHaveLength(14);
    expect(today.hours.every((hour) => hour.site_level === null && hour.wbgt_c.p50 === null)).toBe(true);
  });

  it("answers the same hours for the crew-less yard, under its own site_id", async () => {
    const today = await forecast(EMPTY_SITE);

    expect(today.site_id).toBe(EMPTY_SITE);
    expect(today.hours).toHaveLength(14);
  });

  it("returns a 404 problem for an unknown site", async () => {
    const missing = await get("/api/v1/sites/nope/forecast/today");

    expect(missing.status).toBe(404);
    expect(ProblemSchema.parse(await missing.json())).toMatchObject({ status: 404 });
  });
});

describe("get_risk_policy", () => {
  it("returns the mock policy under version mock-0 and config_version 1, k_health 10, with the bands B3 serves (0, 0.10, 0.50, 0.90)", async () => {
    const policy = await json<Schemas["RiskPolicy"]>(await get("/api/v1/risk-policy"));

    expect(policy.version).toBe("mock-0");
    expect(policy.config_version).toBe(1);
    expect(policy.bands).toEqual([
      { level: "green", min_exceedance_probability: 0 },
      { level: "amber", min_exceedance_probability: 0.1 },
      { level: "orange", min_exceedance_probability: 0.5 },
      { level: "red", min_exceedance_probability: 0.9 },
    ]);
    expect(policy.workload_classes).toEqual([
      { code: "light", metabolic_rate_w: 180 },
      { code: "moderate", metabolic_rate_w: 300 },
      { code: "heavy", metabolic_rate_w: 415 },
    ]);
    expect(policy.clothing_options).toEqual([{ code: "work_clothes", adjustment_c: 0, source: "baseline" }]);
    expect(policy.k_suppression).toBe(5);
    expect(policy.k_health).toBe(10);
  });
});

describe("list_site_crews", () => {
  it("lists the four crews of ADR 0057 with task, workload, local shift and the seed sign-off state", async () => {
    const crews = await crewList();

    expect(crews.map((crew) => [crew.id, crew.member_count, crew.task_label, crew.workload, crew.signoff_state])).toEqual([
      ["crew-a", 12, "Rebar fixing", "heavy", "signed"],
      ["crew-b", 20, "Concrete pour", "heavy", "unsigned"],
      ["crew-c", 9, "Formwork", "moderate", "changed_since_signed"],
      ["crew-d", 4, "Survey and inspection", "light", "signed"],
    ]);
    expect(crews[1]).toEqual({
      id: "crew-b",
      site_id: DEMO_SITE,
      name: "Crew B",
      task_label: "Concrete pour",
      workload: "heavy",
      member_count: 20,
      shift: [
        { start: "06:00", end: "11:00" },
        { start: "15:00", end: "18:00" },
      ],
      signoff_state: "unsigned",
      plan_status: "rule",
      stopped: false,
      active_stop_id: null,
      stopped_at: null,
    });
    expect(await (await get(`/api/v1/sites/${EMPTY_SITE}/crews`)).json()).toEqual([]);
  });

  it("shows an active stop on the crew, with its id for the undo after a reload", async () => {
    await send("POST", "/api/v1/crews/crew-b/stops", { reason_code: "heat" }, EMPLOYER);

    const crew = (await crewList()).find((candidate) => candidate.id === "crew-b");
    expect(crew).toMatchObject({ stopped: true, active_stop_id: "stop-0001", stopped_at: "2026-09-03T07:10:00Z" });
  });

  it("is plan_status fallback when the forecast is missing or stale, and accepts a date", async () => {
    expect((await crewList("fallback")).every((crew) => crew.plan_status === "fallback")).toBe(true);
    expect((await crewList("stale")).every((crew) => crew.plan_status === "fallback")).toBe(true);
    expect((await get(`/api/v1/sites/${DEMO_SITE}/crews?date=2026-11-11`)).status).toBe(200);
    expect((await get(`/api/v1/sites/${DEMO_SITE}/crews?date=x`)).status).toBe(422);
  });

  it("answers 404 for an unknown site", async () => {
    expect((await get("/api/v1/sites/nope/crews")).status).toBe(404);
  });
});

describe("get_crew_timeline", () => {
  it("shows crew-b (20) unsuppressed with the ban window, the L1 shift as UTC instants and an unsigned plan", async () => {
    const result = await timeline("crew-b");

    expect(result).toMatchObject({
      crew_id: "crew-b",
      site_id: DEMO_SITE,
      date: REPLAY_DATE,
      suppressed: false,
      k: 5,
      forecast_status: "fresh",
      signoff_state: "unsigned",
    });
    expect(result.ban_window).toMatchObject({ active_on_date: true, starts_at: "2026-09-03T08:30:00Z", ends_at: "2026-09-03T11:00:00Z" });
    expect(result.shift).toEqual([
      { starts_at: "2026-09-03T02:00:00Z", ends_at: "2026-09-03T07:00:00Z" },
      { starts_at: "2026-09-03T11:00:00Z", ends_at: "2026-09-03T14:00:00Z" },
    ]);
    expect(result.hours).toHaveLength(14);
    expect(hourAt(result.hours, "14:00")).toMatchObject({ crew_level: "red", ban_active: true });
  });

  it("has no share_above_amber anywhere (ADR 0050)", async () => {
    expect(JSON.stringify(await timeline("crew-b"))).not.toContain("share_above_amber");
  });

  it("suppresses crew-d (4 members) but keeps its level; crew-c shows changed_since_signed", async () => {
    const result = await timeline("crew-d");

    expect(result).toMatchObject({ suppressed: true, k: 5, signoff_state: "signed" });
    expect(hourAt(result.hours, "10:00")?.crew_level).toBe("orange");
    expect((await timeline("crew-c")).signoff_state).toBe("changed_since_signed");
  });

  it("builds the hours for the requested date and its ban window is not in force out of season", async () => {
    const result = await timeline("crew-b", "?date=2026-11-11");

    expect(result.date).toBe("2026-11-11");
    expect(result.hours[0]?.starts_at).toBe("2026-11-11T02:00:00Z");
    expect(result.ban_window).toMatchObject({ active_on_date: false, starts_at: null, ends_at: null });
    expect(result.hours.some((hour) => hour.ban_active)).toBe(false);
  });

  it.each(["?date=", "?date=11-11-2026", "?date=2026-13-45", "?date=2026-02-30"])("answers 422 for the timeline query %j", async (query) => {
    const res = await get(`/api/v1/crews/crew-b/timeline${query}`);

    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("uses the replay default date when none is sent, and answers 404 for an unknown crew", async () => {
    expect((await timeline("crew-b")).date).toBe(REPLAY_DATE);
    expect((await get("/api/v1/crews/nope/timeline")).status).toBe(404);
  });

  it("noshift scenario: no published shift; offseason scenario: the timeline is for the same day after the season", async () => {
    expect((await timeline("crew-b")).shift.length).toBeGreaterThan(0);
    expect((await timeline("crew-b", "", "noshift")).shift).toEqual([]);
    const late = await timeline("crew-b", "", "offseason");
    expect(late.date).toBe("2026-09-24");
    expect(late.ban_window.active_on_date).toBe(false);
  });

  it("suppressed scenario: every crew is suppressed; fallback scenario: no level in any hour, status fallback", async () => {
    expect((await timeline("crew-b", "", "suppressed")).suppressed).toBe(true);
    const fallback = await timeline("crew-b", "", "fallback");
    expect(fallback.forecast_status).toBe("fallback");
    expect(fallback.hours.every((hour) => hour.crew_level === null)).toBe(true);
  });
});

describe("get_crew_day_plan", () => {
  it("answers 401 with WWW-Authenticate without a bearer token", async () => {
    const res = await get("/api/v1/crews/crew-b/day-plan");

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(ProblemSchema.parse(await res.json())).toMatchObject({ type: `${PROBLEM_TYPE}unauthorized`, status: 401 });
  });

  it("gives crew-b's canned plan: banner, validator passed with its checked rules, unsigned with its label code", async () => {
    const plan = await dayPlan("crew-b");

    expect(plan).toMatchObject({
      crew_id: "crew-b",
      date: REPLAY_DATE,
      status: "rule",
      signoff_state: "unsigned",
      signoff_label_code: "plan.unsigned_fallback",
      signed_at: null,
      signed_by_role: null,
      banner_code: "plan.floor_banner",
      suppressed: false,
      restricted_headcount: 0,
      forecast_status: "fresh",
      policy_version: "mock-0",
      config_version: 1,
      model_id: "mock",
    });
    expect(plan.ban_window.active_on_date).toBe(true);
    expect(plan.validator).toEqual({ passed: true, violations: [], checked_rules: ["P-H1", "P-H2.daily", "P-H3", "P-H7.cap60", "P-H7.run", "STOP.red"] });
    expect(plan.zone_hours).toHaveLength(14);
  });

  it("carries sign-off labels by state: signed has none and a role, changed_since_signed has its own", async () => {
    expect(await dayPlan("crew-a")).toMatchObject({ signoff_state: "signed", signoff_label_code: null, signed_at: "2026-09-03T01:40:00Z", signed_by_role: "supervisor" });
    expect(await dayPlan("crew-c")).toMatchObject({ signoff_state: "changed_since_signed", signoff_label_code: "plan.changed_since_signed", signed_by_role: "supervisor" });
  });

  it("lists the on-shift blocks and the ban in time order, with the contract's own clause texts and no others", async () => {
    const { segments } = await dayPlan("crew-b");

    expect(segments[0]).toMatchObject({ starts_at: "2026-09-03T02:00:00Z", state: "work", zone: "low" });
    expect(segments.at(-1)?.ends_at).toBe("2026-09-03T14:00:00Z");
    expect(segments.every((segment, index) => index === 0 || segment.starts_at >= (segments[index - 1]?.ends_at ?? ""))).toBe(true);
    const ban = segments.find((segment) => segment.state === "ban");
    expect(ban).toMatchObject({
      starts_at: "2026-09-03T08:30:00Z",
      ends_at: "2026-09-03T11:00:00Z",
      rule_id: "P-H1",
      clause: "Ministerial Resolution 44 of 2022: no outdoor work 12:30-15:00 from 15 June to 15 September.",
    });
    const highRest = segments.find((segment) => segment.state === "adosh_rest" && segment.zone === "high");
    expect(highRest).toMatchObject({
      rule_id: "P-H7.cycle",
      clause: "ADOSH Technical Guideline Table 1, High zone, heavy work: 20 minutes of work, 40 minutes of rest.",
    });
    // Where the contract gives no clause text the clause is empty rather than invented.
    expect(segments.find((segment) => segment.zone === "medium")?.clause).toBe("");
    expect(segments.every((segment) => !segment.clause.includes("Art. 17"))).toBe(true);
  });

  it("derives one acknowledgement item per run of the same Medium or High zone, with ids like high-0600", async () => {
    const { ack_items: items } = await dayPlan("crew-b");

    expect(items.map((item) => [item.id, item.zone, item.text_code])).toEqual([
      ["medium-0800", "medium", "cycle.medium.heavy.45-15"],
      ["high-1000", "high", "cycle.high.heavy.20-40"],
      ["high-1500", "high", "cycle.high.heavy.20-40"],
      ["medium-1700", "medium", "cycle.medium.heavy.45-15"],
    ]);
    expect(items[0]).toMatchObject({ starts_at: "2026-09-03T04:00:00Z", ends_at: "2026-09-03T06:00:00Z" });
  });

  it("gives the light crew the 45/15 High cycle and the other crews theirs", async () => {
    expect((await dayPlan("crew-d")).ack_items.some((item) => item.text_code === "cycle.high.light.45-15")).toBe(true);
    expect((await dayPlan("crew-c")).ack_items.map((item) => item.id)).toEqual((await dayPlan("crew-b")).ack_items.map((item) => item.id));
  });

  it("hides the restricted headcount and every restriction of the suppressed crew-d, and shows crew-a's", async () => {
    const small = await dayPlan("crew-d");
    const big = await dayPlan("crew-a");

    expect(small).toMatchObject({ suppressed: true, restricted_headcount: null, restrictions: [] });
    expect(big).toMatchObject({ suppressed: false, restricted_headcount: 2, restrictions: ["P-H8.ramp"] });
    expect(await dayPlan("crew-a", "", "suppressed")).toMatchObject({ restricted_headcount: null, restrictions: [] });
  });

  it("is the protective fallback with every on-shift hour High when the forecast is missing", async () => {
    const plan = await dayPlan("crew-b", "", "fallback");

    expect(plan).toMatchObject({ status: "fallback", forecast_status: "fallback" });
    expect(plan.validator.passed).toBe(true);
    expect(plan.ack_items.every((item) => item.zone === "high")).toBe(true);
    const onShift = plan.segments.filter((segment) => segment.state === "work" || segment.state === "adosh_rest");
    expect(onShift.every((segment) => segment.zone === "high" && segment.rule_id === "FALLBACK.high")).toBe(true);
  });

  it("stale scenario: forecast_status stale and a fallback plan; empty scenario returns no segments", async () => {
    expect(await dayPlan("crew-b", "", "stale")).toMatchObject({ forecast_status: "stale", status: "fallback" });
    expect(await dayPlan("crew-b", "", "empty")).toMatchObject({ segments: [], zone_hours: [], ack_items: [] });
  });

  it("answers 404 for an unknown crew and 422 for a bad date", async () => {
    expect((await get("/api/v1/crews/nope/day-plan", undefined, EMPLOYER)).status).toBe(404);
    expect((await get("/api/v1/crews/crew-b/day-plan?date=x", undefined, EMPLOYER)).status).toBe(422);
  });
});

describe("sign_off_day_plan", () => {
  const signOff = (crewId: string, body: unknown, headers: Record<string, string> = EMPLOYER, query = "") =>
    send("POST", `/api/v1/crews/${crewId}/day-plan/sign-off${query}`, body, headers);

  it("answers 401 without a token", async () => {
    expect((await signOff("crew-b", { acknowledged_items: [] }, {})).status).toBe(401);
  });

  it("answers 409 review-required listing the missing ids, then 201 once every item is acknowledged", async () => {
    const ids = (await dayPlan("crew-b")).ack_items.map((item) => item.id);

    const refused = await signOff("crew-b", { acknowledged_items: ids.slice(0, 2), deviation_reason_code: null });
    expect(refused.status).toBe(409);
    expect(refused.headers.get("content-type")).toBe("application/problem+json");
    expect(await refused.json()).toMatchObject({ type: `${PROBLEM_TYPE}review-required`, status: 409, missing_items: ids.slice(2) });
    expect((await dayPlan("crew-b")).signoff_state).toBe("unsigned");

    const accepted = await signOff("crew-b", { acknowledged_items: ids, deviation_reason_code: "weather_change" });
    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toEqual({
      crew_id: "crew-b",
      date: REPLAY_DATE,
      signoff_state: "signed",
      signed_at: "2026-09-03T07:10:00Z",
      signed_by_role: "supervisor",
      acknowledged_items: ids,
      deviation_reason_code: "weather_change",
    });
    expect((await timeline("crew-b")).signoff_state).toBe("signed");
    expect((await dayPlan("crew-b")).signoff_label_code).toBeNull();
  });

  it("moves crew-c from changed_since_signed to signed, and answers a signed plan with its recorded sign-off again", async () => {
    const ids = (await dayPlan("crew-c")).ack_items.map((item) => item.id);

    expect((await signOff("crew-c", { acknowledged_items: ids })).status).toBe(201);
    expect((await timeline("crew-c")).signoff_state).toBe("signed");
    const again = await signOff("crew-a", { acknowledged_items: (await dayPlan("crew-a")).ack_items.map((item) => item.id) });
    expect(again.status).toBe(201);
    expect((await json<Schemas["PlanSignOff"]>(again)).signed_at).toBe("2026-09-03T01:40:00Z");
  });

  it("answers 422 for an item that is not in the plan, a bad reason code and a body outside the contract", async () => {
    const unknown = await signOff("crew-b", { acknowledged_items: ["high-0000"] });
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({ errors: [{ loc: ["body", "acknowledged_items", 0] }] });
    expect((await signOff("crew-b", { acknowledged_items: [], deviation_reason_code: "Bad Code" })).status).toBe(422);
    expect((await signOff("crew-b", {})).status).toBe(422);
    expect((await signOff("crew-b", { acknowledged_items: [], extra: 1 })).status).toBe(422);
    expect((await signOff("crew-b", { acknowledged_items: [] }, EMPLOYER, "?date=x")).status).toBe(422);
  });

  it("answers 404 for an unknown crew", async () => {
    expect((await signOff("nope", { acknowledged_items: [] })).status).toBe(404);
  });
});

describe("validate_plan", () => {
  const crew = { workload: "heavy", headcount: 20, acclimatised: true, days_per_week: 6 };
  const validate = (body: Record<string, unknown>) => send("POST", "/api/v1/plans/validate", { site_id: DEMO_SITE, date: REPLAY_DATE, crew, ...body });
  const answer = async (body: Record<string, unknown>) => json<Schemas["PlanValidateResponse"]>(await validate(body));

  it("finds P-H3 (with the contract's Art. 18 clause) and P-H2.daily in the common roster B0", async () => {
    const res = await validate({ roster_text: "06:00-12:30 work\n15:00-17:00 work" });

    expect(res.status).toBe(200);
    const body = await json<Schemas["PlanValidateResponse"]>(res);
    expect(body.validator.passed).toBe(false);
    expect(body.validator.violations.map((violation) => violation.rule_id)).toEqual(["P-H3", "P-H2.daily"]);
    expect(body.validator.violations[0]).toEqual({
      rule_id: "P-H3",
      clause: "Labour Art. 18: a break of one hour after five hours of work.",
      source_id: "ae-labour-art-18",
      ranges: [{ starts_at: "2026-09-03T02:00:00Z", ends_at: "2026-09-03T08:30:00Z" }],
      detail: "6.5 hours of attendance without a one-hour break.",
    });
    // The contract gives no clause text for the daily-hours rule: it is empty, not invented.
    expect(body.validator.violations[1]).toMatchObject({ rule_id: "P-H2.daily", clause: "", source_id: "" });
    expect(body).toMatchObject({ banner_code: "plan.floor_banner", model_id: "mock", forecast_status: "fresh", policy_version: "mock-0", config_version: 1 });
    expect(body.zone_hours).toHaveLength(14);
    expect(body.ban_window.active_on_date).toBe(true);
  });

  it("gives the same answer for the common roster given as segments", async () => {
    const body = await answer({
      segments: [
        { start: "15:00", end: "17:00", state: "work" },
        { start: "06:00", end: "12:30", state: "work" },
      ],
    });

    expect(body.validator.violations.map((violation) => violation.rule_id)).toEqual(["P-H3", "P-H2.daily"]);
  });

  it("has no violations for the legal default L1, and lists the rules it checked", async () => {
    const body = await answer({ roster_text: "06:00-11:00 work\n15:00-18:00 work" });

    expect(body.validator).toEqual({ passed: true, violations: [], checked_rules: ["P-H1", "P-H2.daily", "P-H3", "P-H7.cap60", "P-H7.run"] });
  });

  it("has a canned violation list for work straight through, with P-H1 only in season", async () => {
    const inSeason = await answer({ roster_text: "06:00-18:00 work" });
    const november = await answer({ roster_text: "06:00-18:00 work", date: "2026-11-11" });

    expect(inSeason.validator.violations.map((violation) => violation.rule_id)).toEqual(["P-H1", "P-H3", "P-H2.daily"]);
    expect(inSeason.validator.violations[0]?.clause).toContain("Ministerial Resolution 44 of 2022");
    expect(november.validator.violations.map((violation) => violation.rule_id)).toEqual(["P-H3", "P-H2.daily"]);
  });

  it("answers any other roster with no violations and the checked rules listed", async () => {
    const body = await answer({ roster_text: "07:00-10:00 work\n10:00-10:30 break\n10:30-12:00 work" });

    expect(body.validator.passed).toBe(true);
    expect(body.validator.violations).toEqual([]);
    expect(body.validator.checked_rules.length).toBeGreaterThan(0);
  });

  it("answers 422 roster-invalid with the line numbers of what could not be read", async () => {
    const res = await validate({ roster_text: "06:00-11:00 work\nnot a line\n25:00-26:00 work\n10:00-09:00 rest" });

    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const body = await json<Schemas["RosterInvalidProblem"]>(res);
    expect(body.type).toBe(`${PROBLEM_TYPE}roster-invalid`);
    expect(body.errors.map((error) => error.line)).toEqual([2, 3, 4]);
    expect(body.errors[1]?.message).toBe("start 25:00 is not a time");
  });

  it("needs exactly one of roster_text and segments, a known site and a real date", async () => {
    expect((await validate({})).status).toBe(422);
    expect((await validate({ roster_text: "06:00-07:00 work", segments: [] })).status).toBe(422);
    expect((await validate({ roster_text: "06:00-07:00 work", site_id: "nope" })).status).toBe(404);
    expect((await validate({ roster_text: "06:00-07:00 work", date: "2026-02-30" })).status).toBe(422);
    expect((await validate({ roster_text: "06:00-07:00 work", extra: 1 })).status).toBe(422);
  });
});

describe("push subscriptions", () => {
  const body = {
    subscription: { endpoint: "https://push.example/abc", expirationTime: null, keys: { p256dh: "k", auth: "a" } },
    site_id: DEMO_SITE,
    crew_id: null,
  };

  it("creates (201 with an id) and deletes (204)", async () => {
    const created = await send("POST", "/api/v1/push/subscriptions", body);
    expect(created.status).toBe(201);
    const { id } = await json<Schemas["PushSubscriptionCreated"]>(created);
    expect(id).toMatch(/\S+/);

    const removed = await fetch(`${ORIGIN}/api/v1/push/subscriptions/${id}`, { method: "DELETE" });
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");
  });

  it("answers 422 for a body that is not a subscription, and 404 for an unknown site or crew", async () => {
    const post = (payload: unknown) => send("POST", "/api/v1/push/subscriptions", payload);

    expect((await post({ site_id: DEMO_SITE })).status).toBe(422);
    expect((await post({ ...body, site_id: "nope" })).status).toBe(404);
    expect((await post({ ...body, crew_id: "crew-z" })).status).toBe(404);
    expect((await post({ ...body, crew_id: "crew-b" })).status).toBe(201);
  });
});

describe("create_data_request and get_site_transparency_log", () => {
  const request = (extra: Record<string, unknown> = {}, headers: Record<string, string> = EMPLOYER, site = DEMO_SITE) =>
    send("POST", `/api/v1/sites/${site}/data-requests`, { subject: "worker", data_class: "health", worker_ref: "Ahmed K., staff no. 4471", ...extra }, headers);
  const log = async (site = DEMO_SITE) => json<Schemas["TransparencyLog"]>(await get(`/api/v1/sites/${site}/transparency-log`));

  it("answers 401 without a token and writes nothing", async () => {
    expect((await request({}, {})).status).toBe(401);
    expect((await log()).entries).toEqual([]);
  });

  it.each(["health", "personal", "exposure"])("always answers 403 individual-data-refused for %s and never echoes worker_ref", async (dataClass) => {
    const res = await request({ data_class: dataClass });

    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ type: `${PROBLEM_TYPE}individual-data-refused`, title: "Individual data refused", status: 403 });
    expect(text).not.toContain("Ahmed");
    expect(text).not.toContain("4471");
  });

  it("appends one row per refusal to the in-memory log, newest first, with no subject", async () => {
    await request({ data_class: "health" });
    await request({ data_class: "personal" });

    const { site_id: siteId, entries } = await log();
    expect(siteId).toBe(DEMO_SITE);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: "data_request.refused",
      outcome: "refused",
      actor_role: "employer",
      policy_version: "mock-0",
      config_version: 1,
      model_id: "mock",
    });
    expect(new Date(entries[0]?.at ?? 0).getTime()).toBeGreaterThanOrEqual(new Date(entries[1]?.at ?? 0).getTime());
    expect(JSON.stringify(entries)).not.toContain("Ahmed");
    expect((await log(EMPTY_SITE)).entries).toEqual([]);
  });

  it("answers 422 for a body outside the contract and 404 for an unknown site, writing nothing", async () => {
    expect((await request({ worker_ref: "" })).status).toBe(422);
    expect((await request({ worker_ref: "x".repeat(101) })).status).toBe(422);
    expect((await request({ subject: "crew" })).status).toBe(422);
    expect((await request({}, EMPLOYER, "nope")).status).toBe(404);
    expect((await log()).entries).toEqual([]);
    expect((await get("/api/v1/sites/nope/transparency-log")).status).toBe(404);
  });

  it("returns no entries for the empty scenario", async () => {
    await request();

    const res = await get(`/api/v1/sites/${DEMO_SITE}/transparency-log`, "empty");
    expect((await json<Schemas["TransparencyLog"]>(res)).entries).toEqual([]);
  });
});

describe("create_crew_stop and delete_crew_stop", () => {
  const stop = (crewId = "crew-b", body: unknown = { reason_code: "heat" }, headers: Record<string, string> = EMPLOYER) =>
    send("POST", `/api/v1/crews/${crewId}/stops`, body, headers);

  it("records a stop (201) at the replay clock, uncleared, and answers 401 without a token", async () => {
    expect((await stop("crew-b", { reason_code: "heat" }, {})).status).toBe(401);

    const res = await stop();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "stop-0001", crew_id: "crew-b", started_at: "2026-09-03T07:10:00Z", cleared_at: null });
  });

  it("turns the crew level red from the stop's hour and stops the planned work after it", async () => {
    await stop();

    const result = await timeline("crew-b");
    expect(hourAt(result.hours, "10:00")?.crew_level).toBe("orange");
    expect(hourAt(result.hours, "11:00")?.crew_level).toBe("red");
    expect(hourAt(result.hours, "19:00")?.crew_level).toBe("red");
    const plan = await dayPlan("crew-b");
    expect(plan.validator.passed).toBe(true);
    expect(plan.segments.some((segment) => segment.state === "stopped" && segment.zone === "red" && segment.rule_id === "STOP.red")).toBe(true);
    expect(plan.segments.some((segment) => segment.state === "work" && segment.starts_at >= "2026-09-03T07:00:00Z")).toBe(false);
    expect(plan.ack_items.some((item) => item.zone === "red" && item.text_code === "stop-work")).toBe(true);
    // Other crews are not stopped.
    expect(hourAt((await timeline("crew-a")).hours, "11:00")?.crew_level).toBe("orange");
  });

  it("never waits for sign-off: it works with an unsigned plan and after a refused sign-off", async () => {
    const refused = await send("POST", "/api/v1/crews/crew-b/day-plan/sign-off", { acknowledged_items: [] }, EMPLOYER);
    expect(refused.status).toBe(409);

    expect((await stop()).status).toBe(201);
    expect((await dayPlan("crew-b")).signoff_state).toBe("unsigned");
  });

  it("clears a stop (204, idempotent) so it covers nothing after the undo", async () => {
    const { id } = await json<Schemas["CrewStop"]>(await stop());
    const clear = () => send("DELETE", `/api/v1/crews/crew-b/stops/${id}`, undefined, EMPLOYER);

    expect((await clear()).status).toBe(204);
    expect((await clear()).status).toBe(204);
    expect(hourAt((await timeline("crew-b")).hours, "11:00")?.crew_level).toBe("orange");
    expect((await send("DELETE", "/api/v1/crews/crew-b/stops/stop-9999", undefined, EMPLOYER)).status).toBe(204);
    expect((await send("DELETE", `/api/v1/crews/crew-b/stops/${id}`, undefined, {})).status).toBe(401);
    expect((await send("DELETE", `/api/v1/crews/nope/stops/${id}`, undefined, EMPLOYER)).status).toBe(404);
  });

  it("answers 404 for an unknown crew and 422 for a reason outside the contract", async () => {
    expect((await stop("nope")).status).toBe(404);
    expect((await stop("crew-b", { reason_code: "boredom" })).status).toBe(422);
  });
});

describe("reset_demo_site", () => {
  const reset = (site = DEMO_SITE, headers: Record<string, string> = EMPLOYER) => send("POST", `/api/v1/sites/${site}/demo-reset`, undefined, headers);

  it("starts a new epoch: stops and sign-offs revert to the seed, the transparency log keeps every row", async () => {
    await send("POST", "/api/v1/crews/crew-b/stops", { reason_code: "heat" }, EMPLOYER);
    const ids = (await dayPlan("crew-b")).ack_items.map((item) => item.id);
    await send("POST", "/api/v1/crews/crew-b/day-plan/sign-off", { acknowledged_items: ids }, EMPLOYER);
    await send("POST", `/api/v1/sites/${DEMO_SITE}/data-requests`, { subject: "worker", data_class: "health", worker_ref: "x" }, EMPLOYER);

    const first = await reset();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ site_id: DEMO_SITE, epoch_id: 2, previous_epoch_id: 1 });
    expect(await json<Schemas["DemoReset"]>(await reset())).toMatchObject({ epoch_id: 3, previous_epoch_id: 2 });

    const after = await dayPlan("crew-b");
    expect(after.signoff_state).toBe("unsigned");
    expect(after.segments.some((segment) => segment.state === "stopped")).toBe(false);
    expect((await timeline("crew-c")).signoff_state).toBe("changed_since_signed");
    expect((await json<Schemas["Site"][]>(await get("/api/v1/sites")))[0]?.epoch_id).toBe(3);
    const log = await json<Schemas["TransparencyLog"]>(await get(`/api/v1/sites/${DEMO_SITE}/transparency-log`));
    expect(log.entries).toHaveLength(1);
    expect(JSON.stringify(log)).not.toContain("epoch");
  });

  it("never repeats a stop id across epochs, so an old undo cannot clear a new stop", async () => {
    const first = await json<Schemas["CrewStop"]>(await send("POST", "/api/v1/crews/crew-b/stops", { reason_code: "heat" }, EMPLOYER));
    await reset();
    const second = await json<Schemas["CrewStop"]>(await send("POST", "/api/v1/crews/crew-b/stops", { reason_code: "heat" }, EMPLOYER));

    expect(second.id).not.toBe(first.id);
    expect((await send("DELETE", `/api/v1/crews/crew-b/stops/${first.id}`, undefined, EMPLOYER)).status).toBe(204);
    expect((await crewList()).find((crew) => crew.id === "crew-b")).toMatchObject({ stopped: true, active_stop_id: second.id });
  });

  it("answers 401 without a token and 404 for an unknown site", async () => {
    expect((await reset(DEMO_SITE, {})).status).toBe(401);
    expect((await reset("nope")).status).toBe(404);
  });
});

describe("x-sb-mock-scenario", () => {
  it.each([
    "/api/v1/sites",
    `/api/v1/sites/${DEMO_SITE}/forecast/today`,
    "/api/v1/risk-policy",
    `/api/v1/sites/${DEMO_SITE}/crews`,
    "/api/v1/crews/crew-b/timeline",
    "/api/v1/crews/crew-b/day-plan",
    `/api/v1/sites/${DEMO_SITE}/transparency-log`,
  ])("error returns the 500 problem with request id mock-req-1 for %s", async (path) => {
    const res = await get(path, "error", EMPLOYER);

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(ProblemSchema.parse(await res.json())).toMatchObject({ status: 500, request_id: "mock-req-1" });
  });

  it.each([
    ["POST", "/api/v1/push/subscriptions"],
    ["POST", "/api/v1/plans/validate"],
    ["POST", `/api/v1/sites/${DEMO_SITE}/data-requests`],
    ["POST", "/api/v1/crews/crew-b/stops"],
    ["DELETE", "/api/v1/crews/crew-b/stops/stop-0001"],
    ["POST", "/api/v1/crews/crew-b/day-plan/sign-off"],
    ["POST", `/api/v1/sites/${DEMO_SITE}/demo-reset`],
  ])("error also fails the write %s %s, before the token is read", async (method, path) => {
    const res = await fetch(`${ORIGIN}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-sb-mock-scenario": "error" },
      body: method === "DELETE" ? null : "{}",
    });

    expect(res.status).toBe(500);
  });

  it("empty returns [] for lists and no hours for the day views", async () => {
    expect(await (await get("/api/v1/sites", "empty")).json()).toEqual([]);
    expect(await crewList("empty")).toEqual([]);
    expect((await forecast(DEMO_SITE, "empty")).hours).toEqual([]);
    expect((await timeline("crew-b", "", "empty")).hours).toEqual([]);
  });

  it("shift-not-legal answers the day plan and the sign-off with a 422 ShiftNotLegalProblem that lists the violated clauses", async () => {
    const reads = await get("/api/v1/crews/crew-b/day-plan", "shift-not-legal", EMPLOYER);
    const signs = await fetch(`${ORIGIN}/api/v1/crews/crew-b/day-plan/sign-off`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sb-mock-scenario": "shift-not-legal", ...EMPLOYER },
      body: JSON.stringify({ acknowledged_items: [] }),
    });

    for (const res of [reads, signs]) {
      expect(res.status).toBe(422);
      expect(res.headers.get("content-type")).toBe("application/problem+json");
      const body = await json<Schemas["ShiftNotLegalProblem"]>(res);
      expect(body).toMatchObject({ status: 422, type: `${PROBLEM_TYPE}shift-not-legal`, title: "Shift not legal", request_id: "mock-req-1" });
      expect(body.violations.length).toBeGreaterThan(0);
      for (const violation of body.violations) expect(Object.keys(violation).sort()).toEqual(["clause", "rule_id", "source_id"]);
    }
  });

  it("shift-not-legal leaves every other operation alone, and a stop is never refused for it", async () => {
    expect((await get("/api/v1/crews/crew-b/timeline", "shift-not-legal")).status).toBe(200);
    expect((await get(`/api/v1/sites/${DEMO_SITE}/crews`, "shift-not-legal")).status).toBe(200);
    const stop = await fetch(`${ORIGIN}/api/v1/crews/crew-b/stops`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sb-mock-scenario": "shift-not-legal", ...EMPLOYER },
      body: JSON.stringify({ reason_code: "heat" }),
    });
    expect(stop.status).toBe(201);
  });

  it.each([
    ["GET", `/api/v1/sites/${DEMO_SITE}/crews`],
    ["GET", `/api/v1/sites/${DEMO_SITE}/forecast/today`],
    ["GET", "/api/v1/risk-policy"],
    ["GET", "/api/v1/crews/crew-b/timeline"],
    ["GET", "/api/v1/crews/crew-b/day-plan"],
    ["POST", "/api/v1/crews/crew-b/day-plan/sign-off"],
    ["POST", "/api/v1/plans/validate"],
    ["POST", `/api/v1/sites/${DEMO_SITE}/data-requests`],
  ])("unavailable answers %s %s with the 503 dependency-unavailable problem the contract lists for it", async (method, path) => {
    const res = await fetch(`${ORIGIN}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-sb-mock-scenario": "unavailable", ...EMPLOYER },
      ...(method === "GET" ? {} : { body: "{}" }),
    });

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await json<Schemas["Problem"] & { dependency?: string }>(res)).toMatchObject({
      status: 503,
      type: `${PROBLEM_TYPE}dependency-unavailable`,
      title: "Dependency unavailable",
      dependency: "config",
      request_id: "mock-req-1",
    });
  });

  it.each([
    ["GET", "/api/v1/sites"],
    ["POST", "/api/v1/crews/crew-b/stops"],
    ["DELETE", "/api/v1/crews/crew-b/stops/stop-0001"],
    ["GET", `/api/v1/sites/${DEMO_SITE}/transparency-log`],
  ])("unavailable leaves %s %s alone: the contract lists no 503 for it", async (method, path) => {
    const res = await fetch(`${ORIGIN}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-sb-mock-scenario": "unavailable", ...EMPLOYER },
      ...(method === "POST" ? { body: JSON.stringify({ reason_code: "heat" }) } : {}),
    });

    expect(res.status).toBeLessThan(300);
  });

  it("ignores an unknown scenario", async () => {
    expect((await forecast(DEMO_SITE, "nonsense")).hours).toHaveLength(14);
  });
});

describe("named overrides", () => {
  it("problemOnce fails the matching path once, then the default handler answers", async () => {
    server.use(problemOnce("/api/v1/sites", 503));

    const first = await get("/api/v1/sites");
    expect(first.status).toBe(503);
    expect(ProblemSchema.parse(await first.json())).toMatchObject({ status: 503, request_id: "mock-req-1" });
    expect((await get("/api/v1/sites")).status).toBe(200);
  });

  it("problemOnce matches path parameters", async () => {
    server.use(problemOnce("/api/v1/sites/:site_id/forecast/today", 500));

    expect((await get(`/api/v1/sites/${DEMO_SITE}/forecast/today`)).status).toBe(500);
    expect((await get(`/api/v1/sites/${DEMO_SITE}/forecast/today`)).status).toBe(200);
  });

  it("staleToday serves a forecast generated 26 hours ago", async () => {
    server.use(staleToday());

    const generatedAt = new Date((await forecast()).generated_at).getTime();
    expect(Date.now() - generatedAt).toBeGreaterThanOrEqual(26 * HOUR_MS);
  });

  it("unhandled requests are errors, not silent passthroughs", async () => {
    await expect(fetch("http://unhandled.test/anything")).rejects.toThrow();
  });

  it("a test's own handler wins over the default one", async () => {
    server.use(http.get("*/api/v1/sites", () => HttpResponse.json([])));

    expect(await (await get("/api/v1/sites")).json()).toEqual([]);
  });
});

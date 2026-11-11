// @vitest-environment node
import { http, HttpResponse } from "msw/http";
import type { components } from "@/api/schema";
import { ProblemSchema } from "@/api/problem-schema";
import { problemOnce, staleToday } from "@/mocks/handlers";
import { server } from "@/mocks/node";

/*
 * The fixtures and handlers are the contract the later tasks build and test against (unit tests, and e2e through
 * the standalone mock server), so the values other tasks rely on are pinned here.
 */

type Schemas = components["schemas"];

const ORIGIN = "http://mock.test";
const DEMO_SITE = "site-demo-mussafah";
const HOUR_MS = 3_600_000;

async function get(path: string, scenario?: string): Promise<Response> {
  return fetch(`${ORIGIN}${path}`, scenario === undefined ? {} : { headers: { "x-sb-mock-scenario": scenario } });
}

async function forecast(siteId = DEMO_SITE, scenario?: string): Promise<Schemas["SiteForecastToday"]> {
  return (await (await get(`/api/v1/sites/${siteId}/forecast/today`, scenario)).json()) as Schemas["SiteForecastToday"];
}

/** The local hour of an instant at Asia/Dubai (UTC+4, no daylight saving), as "HH:00". */
function dubaiHour(startsAt: string): string {
  const hour = (new Date(startsAt).getUTCHours() + 4) % 24;
  return `${String(hour).padStart(2, "0")}:00`;
}

function hourAt<T extends { starts_at: string }>(hours: T[], local: string): T | undefined {
  return hours.find((hour) => dubaiHour(hour.starts_at) === local);
}

describe("GET /api/v1/sites", () => {
  it("returns the two synthetic demo yards in Asia/Dubai", async () => {
    const res = await get("/api/v1/sites");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: "site-demo-mussafah", name: "Demo yard A (synthetic)", timezone: "Asia/Dubai", synthetic: true },
      { id: "site-demo-empty", name: "Demo yard B (synthetic, no crews)", timezone: "Asia/Dubai", synthetic: true },
    ]);
  });
});

describe("GET /api/v1/sites/{site_id}/forecast/today", () => {
  it("covers 05:00 to 19:00 local on 2026-11-11, 15 hours, with the pinned versions", async () => {
    const today = await forecast();

    expect(today).toMatchObject({ site_id: DEMO_SITE, date: "2026-11-11", policy_version: "mock-0", config_version: 1 });
    expect(today.hours).toHaveLength(15);
    expect(dubaiHour(today.hours[0]?.starts_at ?? "")).toBe("05:00");
    expect(dubaiHour(today.hours.at(-1)?.starts_at ?? "")).toBe("19:00");
    expect(today.hours[0]?.starts_at).toBe("2026-11-11T01:00:00Z");
    const times = today.hours.map((hour) => new Date(hour.starts_at).getTime());
    expect(times.every((time, index) => index === 0 || time - (times[index - 1] ?? 0) === HOUR_MS)).toBe(true);
  });

  it("has the 13:00 orange hour with the pinned quantiles and an active ban", async () => {
    const hour = hourAt((await forecast()).hours, "13:00");

    expect(hour).toMatchObject({ wbgt_c: { p05: 26, p50: 28, p95: 30 }, site_level: "orange", ban_active: true });
  });

  it("rises to orange for 13:00 to 15:00 and the ban covers 13:00 and 14:00", async () => {
    const { hours } = await forecast();
    const level = (local: string) => hourAt(hours, local)?.site_level;

    expect([level("12:00"), level("13:00"), level("14:00"), level("15:00"), level("16:00")]).toEqual([
      "amber",
      "orange",
      "orange",
      "orange",
      "amber",
    ]);
    const banned = hours.filter((hour) => hour.ban_active).map((hour) => dubaiHour(hour.starts_at));
    expect(banned).toEqual(["13:00", "14:00"]);
  });

  it("has no data at 19:00: null quantiles and a null level", async () => {
    const hour = hourAt((await forecast()).hours, "19:00");

    expect(hour).toMatchObject({ wbgt_c: { p05: null, p50: null, p95: null }, site_level: null, ban_active: false });
  });

  it("answers the same hours for the crew-less yard, under its own site_id", async () => {
    const today = await forecast("site-demo-empty");

    expect(today.site_id).toBe("site-demo-empty");
    expect(today.hours).toHaveLength(15);
  });

  it("is fresh by default and 26 hours old for the stale scenario", async () => {
    const age = (generatedAt: string) => Date.now() - new Date(generatedAt).getTime();

    expect(age((await forecast()).generated_at)).toBeLessThan(HOUR_MS);
    expect(age((await forecast(DEMO_SITE, "stale")).generated_at)).toBeGreaterThanOrEqual(26 * HOUR_MS);
    expect(age((await forecast(DEMO_SITE, "stale")).generated_at)).toBeLessThan(27 * HOUR_MS);
  });

  it("returns a 404 problem for an unknown site", async () => {
    const res = await get("/api/v1/sites/nope/forecast/today");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(ProblemSchema.parse(await res.json())).toMatchObject({ status: 404 });
  });
});

describe("GET /api/v1/risk-policy", () => {
  it("returns the placeholder policy under version mock-0 and config_version 1", async () => {
    const policy = (await (await get("/api/v1/risk-policy")).json()) as Schemas["RiskPolicy"];

    expect(policy.version).toBe("mock-0");
    expect(policy.config_version).toBe(1);
    expect(policy.bands).toEqual([
      { level: "green", min_exceedance_probability: 0 },
      { level: "amber", min_exceedance_probability: 0.1 },
      { level: "orange", min_exceedance_probability: 0.3 },
      { level: "red", min_exceedance_probability: 0.6 },
    ]);
    expect(policy.workload_classes).toEqual([
      { code: "light", metabolic_rate_w: 180 },
      { code: "moderate", metabolic_rate_w: 300 },
      { code: "heavy", metabolic_rate_w: 415 },
    ]);
    expect(policy.clothing_options).toEqual([{ code: "work_clothes", adjustment_c: 0, source: "baseline" }]);
    expect(policy.k_suppression).toBe(5);
  });
});

describe("crews", () => {
  it("lists crew-a (12) and crew-b (3) for the demo yard and none for the empty one", async () => {
    const crews = (await (await get(`/api/v1/sites/${DEMO_SITE}/crews`)).json()) as Schemas["Crew"][];
    expect(crews.map((crew) => [crew.id, crew.member_count])).toEqual([
      ["crew-a", 12],
      ["crew-b", 3],
    ]);
    expect(await (await get("/api/v1/sites/site-demo-empty/crews")).json()).toEqual([]);
  });

  it("shows crew-a at 42% above amber at 13:00 and nothing suppressed", async () => {
    const timeline = (await (await get("/api/v1/crews/crew-a/timeline?date=2026-11-11")).json()) as Schemas["CrewTimeline"];

    expect(timeline).toMatchObject({ crew_id: "crew-a", site_id: DEMO_SITE, date: "2026-11-11", suppressed: false, k: 5 });
    expect(hourAt(timeline.hours, "13:00")).toMatchObject({ crew_level: "orange", share_above_amber: 0.42, ban_active: true });
    expect(hourAt(timeline.hours, "19:00")).toMatchObject({ crew_level: null, share_above_amber: null });
  });

  it("suppresses crew-b: no share on any hour", async () => {
    const timeline = (await (await get("/api/v1/crews/crew-b/timeline?date=2026-11-11")).json()) as Schemas["CrewTimeline"];

    expect(timeline).toMatchObject({ crew_id: "crew-b", suppressed: true, k: 5 });
    expect(timeline.hours).toHaveLength(15);
    expect(timeline.hours.every((hour) => hour.share_above_amber === null)).toBe(true);
    expect(hourAt(timeline.hours, "13:00")?.crew_level).toBe("orange");
  });

  it("builds the hours for the requested date", async () => {
    const timeline = (await (await get("/api/v1/crews/crew-a/timeline?date=2026-12-01")).json()) as Schemas["CrewTimeline"];

    expect(timeline.date).toBe("2026-12-01");
    expect(timeline.hours[0]?.starts_at).toBe("2026-12-01T01:00:00Z");
  });

  it.each(["", "?date=", "?date=11-11-2026", "?date=2026-13-45", "?date=2026-02-30"])("answers 422 for the timeline query %j", async (query) => {
    const res = await get(`/api/v1/crews/crew-a/timeline${query}`);

    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("answers 404 for an unknown crew and an unknown site's crews", async () => {
    expect((await get("/api/v1/crews/nope/timeline?date=2026-11-11")).status).toBe(404);
    expect((await get("/api/v1/sites/nope/crews")).status).toBe(404);
  });
});

describe("push subscriptions", () => {
  const body = {
    subscription: { endpoint: "https://push.example/abc", expirationTime: null, keys: { p256dh: "k", auth: "a" } },
    site_id: DEMO_SITE,
    crew_id: null,
  };

  it("creates (201 with an id) and deletes (204)", async () => {
    const created = await fetch(`${ORIGIN}/api/v1/push/subscriptions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as Schemas["PushSubscriptionCreated"];
    expect(id).toMatch(/\S+/);

    const removed = await fetch(`${ORIGIN}/api/v1/push/subscriptions/${id}`, { method: "DELETE" });
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");
  });

  it("answers 422 for a body that is not a subscription, and 404 for an unknown site", async () => {
    const post = (payload: unknown) =>
      fetch(`${ORIGIN}/api/v1/push/subscriptions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

    expect((await post({ site_id: DEMO_SITE })).status).toBe(422);
    expect((await post({ ...body, site_id: "nope" })).status).toBe(404);
  });
});

describe("x-sb-mock-scenario", () => {
  it.each([
    "/api/v1/sites",
    `/api/v1/sites/${DEMO_SITE}/forecast/today`,
    "/api/v1/risk-policy",
    `/api/v1/sites/${DEMO_SITE}/crews`,
    "/api/v1/crews/crew-a/timeline?date=2026-11-11",
  ])("error returns the 500 problem with request id mock-req-1 for %s", async (path) => {
    const res = await get(path, "error");

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(ProblemSchema.parse(await res.json())).toMatchObject({ status: 500, request_id: "mock-req-1" });
  });

  it("error also fails a write", async () => {
    const res = await fetch(`${ORIGIN}/api/v1/push/subscriptions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sb-mock-scenario": "error" },
      body: "{}",
    });

    expect(res.status).toBe(500);
  });

  it("empty returns [] for lists and no hours for the day views", async () => {
    expect(await (await get("/api/v1/sites", "empty")).json()).toEqual([]);
    expect(await (await get(`/api/v1/sites/${DEMO_SITE}/crews`, "empty")).json()).toEqual([]);
    expect((await forecast(DEMO_SITE, "empty")).hours).toEqual([]);
    const timeline = (await (await get("/api/v1/crews/crew-a/timeline?date=2026-11-11", "empty")).json()) as Schemas["CrewTimeline"];
    expect(timeline.hours).toEqual([]);
  });

  it("ignores an unknown scenario", async () => {
    expect((await forecast(DEMO_SITE, "nonsense")).hours).toHaveLength(15);
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

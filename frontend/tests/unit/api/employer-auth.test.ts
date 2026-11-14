// @vitest-environment node
import { http, HttpResponse } from "msw/http";
import { DELETE, GET, POST } from "@/app/api/v1/[...path]/route";
import { employerAuth, forwardHeaders } from "@/app/api/v1/[...path]/employer-auth";
import { server } from "@/mocks/node";

/*
 * The public demo has no employer sign-in: the BFF holds one demo employer token and attaches it only to an allow-list
 * of method and path pairs on the demo fixture (ADR 0051 decision 5, F2 decision D4). The matcher is pure and tested
 * directly; the route tests then run the real proxy against an MSW upstream, which sees exactly what the API would.
 */

const UPSTREAM = "http://upstream.test";

describe("employerAuth: the allow-list", () => {
  it.each([
    ["GET", "/api/v1/crews/crew-b/day-plan", false],
    ["POST", "/api/v1/sites/site-demo-mussafah/data-requests", true],
    ["POST", "/api/v1/crews/crew-b/stops", true],
    ["DELETE", "/api/v1/crews/crew-b/stops/stop-mock-1", true],
    ["POST", "/api/v1/crews/crew-b/day-plan/sign-off", true],
    ["POST", "/api/v1/sites/site-demo-mussafah/demo-reset", true],
    ["GET", "/api/v1/crews/crew-a/day-plan", false],
    ["POST", "/api/v1/crews/crew-d/stops", true],
    ["post", "/api/v1/crews/crew-c/stops", true],
  ])("test_bff_injects_token_only_on_allow_list: %s %s injects", (method, path, write) => {
    expect(employerAuth(method, path)).toEqual({ inject: true, write });
  });

  it.each([
    ["GET", "/api/v1/sites"],
    ["GET", "/api/v1/sites/site-demo-mussafah/crews"],
    ["GET", "/api/v1/sites/site-demo-mussafah/transparency-log"],
    ["GET", "/api/v1/crews/crew-b/timeline"],
    ["GET", "/api/v1/risk-policy"],
    ["POST", "/api/v1/plans/validate"],
    ["POST", "/api/v1/push/subscriptions"],
    ["DELETE", "/api/v1/push/subscriptions/sub-1"],
    // a crew id outside crew-[a-d]
    ["GET", "/api/v1/crews/crew-e/day-plan"],
    ["POST", "/api/v1/crews/crew-ab/stops"],
    ["POST", "/api/v1/crews/crew-b2/day-plan/sign-off"],
    ["GET", "/api/v1/crews/other/day-plan"],
    // a site id that does not start with site-demo-
    ["POST", "/api/v1/sites/site-prod-1/data-requests"],
    ["POST", "/api/v1/sites/mussafah/data-requests"],
    ["POST", "/api/v1/sites/site-demo/data-requests"],
    ["POST", "/api/v1/sites/xsite-demo-mussafah/demo-reset"],
    // the right path with the wrong method, and the wrong path with a right method
    ["POST", "/api/v1/crews/crew-b/day-plan"],
    ["GET", "/api/v1/crews/crew-b/day-plan/sign-off"],
    ["GET", "/api/v1/crews/crew-b/stops"],
    ["DELETE", "/api/v1/crews/crew-b/day-plan"],
    ["GET", "/api/v1/sites/site-demo-mussafah/data-requests"],
    ["DELETE", "/api/v1/sites/site-demo-mussafah/demo-reset"],
    // look-alikes: trailing slash, extra segment, traversal, another prefix
    ["GET", "/api/v1/crews/crew-b/day-plan/"],
    ["GET", "/api/v1/crews/crew-b/day-plan/extra"],
    ["DELETE", "/api/v1/crews/crew-b/stops/a/b"],
    ["GET", "/api/v1/crews/crew-b/../crew-e/day-plan"],
    ["GET", "/api/v2/crews/crew-b/day-plan"],
    ["GET", "/crews/crew-b/day-plan"],
  ])("does not inject for %s %s", (method, path) => {
    expect(employerAuth(method, path)).toEqual({ inject: false, write: false });
  });
});

describe("forwardHeaders", () => {
  const incoming = () =>
    new Headers({
      "content-type": "application/json",
      accept: "application/json",
      "x-request-id": "in-1",
      cookie: "session=secret",
      authorization: "Bearer client-token",
      "x-forwarded-for": "10.0.0.1",
    });

  it("test_client_authorization_is_stripped: a client Authorization never goes upstream, injected or not", () => {
    expect(forwardHeaders(incoming(), undefined).get("authorization")).toBeNull();
    expect(forwardHeaders(incoming(), "demo-token").get("authorization")).toBe("Bearer demo-token");
  });

  it("test_no_injection_without_env_token: no token (unset or empty) means no Authorization header", () => {
    expect(forwardHeaders(new Headers(), undefined).has("authorization")).toBe(false);
    expect(forwardHeaders(new Headers(), "").has("authorization")).toBe(false);
  });

  it("carries content-type, accept and x-request-id, and nothing else", () => {
    const headers = forwardHeaders(incoming(), "demo-token");

    expect([...headers.keys()].sort()).toEqual(["accept", "authorization", "content-type", "x-request-id"]);
  });

  it("forwards the mock scenario header outside production and in production only with SB_MOCK_SCENARIOS=1", () => {
    const withScenario = () => new Headers({ "x-sb-mock-scenario": "fallback" });

    expect(forwardHeaders(withScenario(), undefined).get("x-sb-mock-scenario")).toBe("fallback");
    vi.stubEnv("NODE_ENV", "production");
    expect(forwardHeaders(withScenario(), undefined).get("x-sb-mock-scenario")).toBeNull();
    vi.stubEnv("SB_MOCK_SCENARIOS", "1");
    expect(forwardHeaders(withScenario(), undefined).get("x-sb-mock-scenario")).toBe("fallback");
    vi.unstubAllEnvs();
  });
});

describe("the proxy route", () => {
  function incomingRequest(path: string, init: RequestInit = {}): Request {
    return new Request(`http://localhost:3000${path}`, init);
  }

  /** Records the Authorization header of every request the upstream receives. */
  function recordAuthorization(): (string | null)[] {
    const seen: (string | null)[] = [];
    server.use(
      http.all(`${UPSTREAM}/api/v1/*`, ({ request }) => {
        seen.push(request.headers.get("authorization"));
        return HttpResponse.json({});
      }),
    );
    return seen;
  }

  beforeEach(() => {
    vi.stubEnv("API_ORIGIN", UPSTREAM);
    vi.stubEnv("DEMO_EMPLOYER_TOKEN", "demo-secret");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("injects the demo token on an allow-listed pair, replacing whatever the client sent", async () => {
    const seen = recordAuthorization();

    await GET(incomingRequest("/api/v1/crews/crew-b/day-plan?date=2026-09-03", { headers: { authorization: "Bearer visitor" } }));
    await POST(incomingRequest("/api/v1/crews/crew-b/stops", { method: "POST", body: "{}", headers: { "x-forwarded-for": "route-1" } }));

    expect(seen).toEqual(["Bearer demo-secret", "Bearer demo-secret"]);
  });

  it("sends no Authorization for any other path, even with a token configured and a client header", async () => {
    const seen = recordAuthorization();

    await GET(incomingRequest("/api/v1/sites", { headers: { authorization: "Bearer visitor" } }));
    await GET(incomingRequest("/api/v1/crews/crew-e/day-plan", { headers: { authorization: "Bearer visitor" } }));
    await POST(incomingRequest("/api/v1/sites/site-prod-1/data-requests", { method: "POST", body: "{}" }));

    expect(seen).toEqual([null, null, null]);
  });

  it("sends no Authorization without DEMO_EMPLOYER_TOKEN, so the API refuses with its own 401", async () => {
    vi.stubEnv("DEMO_EMPLOYER_TOKEN", "");
    const seen = recordAuthorization();

    await GET(incomingRequest("/api/v1/crews/crew-b/day-plan", { headers: { authorization: "Bearer visitor" } }));

    expect(seen).toEqual([null]);
  });

  it("forwards a DELETE of a stop with the token", async () => {
    const seen = recordAuthorization();

    await DELETE(incomingRequest("/api/v1/crews/crew-b/stops/stop-1", { method: "DELETE", headers: { "x-forwarded-for": "route-2" } }));

    expect(seen).toEqual(["Bearer demo-secret"]);
  });
});

describe("the proxy route: write rate limit (decision D4)", () => {
  const WRITE = "/api/v1/crews/crew-b/stops";

  function write(ip: string): Request {
    return new Request(`http://localhost:3000${WRITE}`, { method: "POST", body: "{}", headers: { "x-forwarded-for": ip } });
  }

  beforeEach(() => {
    vi.stubEnv("API_ORIGIN", UPSTREAM);
    vi.stubEnv("DEMO_EMPLOYER_TOKEN", "demo-secret");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    server.use(http.all(`${UPSTREAM}/api/v1/*`, () => HttpResponse.json({})));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("answers 429 problem+json with Retry-After once a client bucket is empty, and only for that client", async () => {
    vi.stubEnv("DEMO_WRITE_RATE_PER_MIN", "2");
    vi.stubEnv("DEMO_WRITE_GLOBAL_RATE_PER_MIN", "50");

    expect((await POST(write("203.0.113.1"))).status).toBe(200);
    expect((await POST(write("203.0.113.1"))).status).toBe(200);
    const limited = await POST(write("203.0.113.1"));

    expect(limited.status).toBe(429);
    expect(limited.headers.get("content-type")).toBe("application/problem+json");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await limited.json()).toMatchObject({ type: "urn:stellar-blaze:problem:rate-limited", status: 429 });
    expect((await POST(write("203.0.113.2"))).status).toBe(200);
  });

  it("limits all clients together with the global bucket, so rotating addresses does not help", async () => {
    vi.stubEnv("DEMO_WRITE_RATE_PER_MIN", "10");
    vi.stubEnv("DEMO_WRITE_GLOBAL_RATE_PER_MIN", "3");

    const statuses: number[] = [];
    for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3", "198.51.100.4"]) statuses.push((await POST(write(ip))).status);

    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("does not limit reads, and does not limit a write path outside the allow-list", async () => {
    vi.stubEnv("DEMO_WRITE_RATE_PER_MIN", "1");
    vi.stubEnv("DEMO_WRITE_GLOBAL_RATE_PER_MIN", "1");
    const read = () => GET(new Request("http://localhost:3000/api/v1/crews/crew-b/day-plan", { headers: { "x-forwarded-for": "192.0.2.9" } }));
    const other = () =>
      POST(new Request("http://localhost:3000/api/v1/plans/validate", { method: "POST", body: "{}", headers: { "x-forwarded-for": "192.0.2.9" } }));

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await read()).status).toBe(200);
      expect((await other()).status).toBe(200);
    }
  });

  it("falls back to the default limits for an invalid setting (20 per client per minute)", async () => {
    vi.stubEnv("DEMO_WRITE_RATE_PER_MIN", "not a number");
    vi.stubEnv("DEMO_WRITE_GLOBAL_RATE_PER_MIN", "0");

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 21; attempt += 1) statuses.push((await POST(write("100.64.0.1"))).status);

    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

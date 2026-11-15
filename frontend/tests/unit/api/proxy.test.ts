// @vitest-environment node
import { http, HttpResponse } from "msw/http";
import { DELETE, GET, POST } from "@/app/api/v1/[...path]/route";
import { server } from "@/mocks/node";

/*
 * The browser calls only same-origin /api/v1/*; this route handler forwards to API_ORIGIN (the FastAPI app).
 * Upstream is an MSW handler on an absolute origin, so the handlers run the real proxy code, including fetch.
 */

const UPSTREAM = "http://upstream.test";
const PROBLEM_JSON = "application/problem+json";

function incoming(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost:3000${path}`, init);
}

beforeEach(() => {
  vi.stubEnv("API_ORIGIN", UPSTREAM);
  // A 502 is logged server-side with its request id (the browser only gets a generic problem): asserted, not printed.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET", () => {
  it("returns the upstream body and passes x-request-id through, forwarding the query string", async () => {
    const seenUrls: string[] = [];
    server.use(
      http.get(`${UPSTREAM}/api/v1/sites`, ({ request }) => {
        seenUrls.push(request.url);
        return HttpResponse.json([{ id: "site-1" }], { headers: { "x-request-id": "up-1" } });
      }),
    );

    const res = await GET(incoming("/api/v1/sites?x=1", { headers: { "x-request-id": "in-1" } }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "site-1" }]);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("x-request-id")).toBe("up-1");
    expect(seenUrls).toEqual([`${UPSTREAM}/api/v1/sites?x=1`]);
  });

  it("forwards content-type, accept and x-request-id to the upstream, and nothing else", async () => {
    const seen: Headers[] = [];
    server.use(
      http.get(`${UPSTREAM}/api/v1/risk-policy`, ({ request }) => {
        seen.push(request.headers);
        return HttpResponse.json({});
      }),
    );

    await GET(
      incoming("/api/v1/risk-policy", {
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-request-id": "in-2",
          cookie: "session=secret",
          authorization: "Bearer secret",
          "x-forwarded-for": "10.0.0.1",
        },
      }),
    );

    const [headers] = seen;
    expect(headers?.get("accept")).toBe("application/json");
    expect(headers?.get("x-request-id")).toBe("in-2");
    expect(headers?.get("cookie")).toBeNull();
    expect(headers?.get("authorization")).toBeNull();
    expect(headers?.get("x-forwarded-for")).toBeNull();
  });

  it("streams an upstream problem+json through with its status and request id", async () => {
    const body = { type: "urn:x", title: "Not Found", status: 404, request_id: "up-404" };
    server.use(
      http.get(`${UPSTREAM}/api/v1/sites/nope/crews`, () =>
        HttpResponse.json(body, {
          status: 404,
          headers: { "content-type": PROBLEM_JSON, "x-request-id": "up-404" },
        }),
      ),
    );

    const res = await GET(incoming("/api/v1/sites/nope/crews"));

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe(PROBLEM_JSON);
    expect(res.headers.get("x-request-id")).toBe("up-404");
    expect(await res.json()).toEqual(body);
  });

  it("answers 502 problem+json when API_ORIGIN is unset", async () => {
    vi.stubEnv("API_ORIGIN", undefined);

    const res = await GET(incoming("/api/v1/sites", { headers: { "x-request-id": "in-3" } }));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toBe(PROBLEM_JSON);
    expect(res.headers.get("x-request-id")).toBe("in-3");
    expect(body).toMatchObject({
      type: "urn:stellar-blaze:problem:upstream-unavailable",
      status: 502,
      request_id: "in-3",
    });
    expect(console.error).toHaveBeenCalledWith("bff: upstream unavailable", expect.objectContaining({ request_id: "in-3" }));
  });

  it("answers 502 problem+json with a generated request id when the upstream is unreachable", async () => {
    server.use(http.get(`${UPSTREAM}/api/v1/sites`, () => HttpResponse.error()));

    const res = await GET(incoming("/api/v1/sites"));
    const body = (await res.json()) as { type: string; request_id: string };

    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toBe(PROBLEM_JSON);
    expect(body.type).toBe("urn:stellar-blaze:problem:upstream-unavailable");
    expect(body.request_id).toMatch(/\S+/);
    expect(res.headers.get("x-request-id")).toBe(body.request_id);
    expect(console.error).toHaveBeenCalledWith(
      "bff: upstream unavailable",
      expect.objectContaining({ request_id: body.request_id, cause: expect.any(Error) as unknown }),
    );
  });

  it("gives the upstream 10 s to answer; when that signal fires the answer is a 502", async () => {
    // AbortSignal.timeout runs on an internal timer that fake timers cannot advance, so hand the route a signal that has already fired.
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    server.use(http.get(`${UPSTREAM}/api/v1/sites`, () => new Promise<Response>(() => undefined)));

    const res = await GET(incoming("/api/v1/sites"));

    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toBe(PROBLEM_JSON);
  });

  it("asks fetch for cache: no-store, so no layer (Next's data cache included) can serve an old answer", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    server.use(http.get(`${UPSTREAM}/api/v1/sites`, () => HttpResponse.json([])));

    await GET(incoming("/api/v1/sites"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store" });
  });
});

describe("paths outside /api/v1", () => {
  it.each(["/api/v1/%2e%2e/%2e%2e/admin", "/api/v1/a/../../admin", "/api/v1/%2E%2E/admin"])(
    "does not forward %s (it resolves out of the prefix) and answers 404 problem+json",
    async (path) => {
      const upstream = vi.fn(() => HttpResponse.json({ leaked: true }));
      server.use(http.all(`${UPSTREAM}/*`, upstream));

      const res = await GET(incoming(path));

      expect(upstream).not.toHaveBeenCalled();
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toBe(PROBLEM_JSON);
    },
  );
});

describe("x-sb-mock-scenario", () => {
  /** The scenario header the upstream received, or null when it was dropped. Fails if the upstream was not called. */
  async function upstreamSeesScenario(): Promise<string | null> {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${UPSTREAM}/api/v1/sites`, ({ request }) => {
        seen.push(request.headers.get("x-sb-mock-scenario"));
        return HttpResponse.json([]);
      }),
    );
    await GET(incoming("/api/v1/sites", { headers: { "x-sb-mock-scenario": "error" } }));
    expect(seen).toHaveLength(1);
    return seen[0] ?? null;
  }

  it("is forwarded outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(await upstreamSeesScenario()).toBe("error");
  });

  it("is dropped in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(await upstreamSeesScenario()).toBeNull();
  });

  it("is forwarded in production when SB_MOCK_SCENARIOS=1 (the e2e web server)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SB_MOCK_SCENARIOS", "1");

    expect(await upstreamSeesScenario()).toBe("error");
  });
});

describe("POST", () => {
  it("forwards the method, body and content-type and returns the 201 body", async () => {
    const seen: { method: string; contentType: string | null; body: unknown }[] = [];
    server.use(
      http.post(`${UPSTREAM}/api/v1/push/subscriptions`, async ({ request }) => {
        seen.push({
          method: request.method,
          contentType: request.headers.get("content-type"),
          body: await request.json(),
        });
        return HttpResponse.json({ id: "sub-1" }, { status: 201 });
      }),
    );
    const payload = { site_id: "site-demo-mussafah", crew_id: null };

    const res = await POST(
      incoming("/api/v1/push/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "sub-1" });
    expect(seen).toEqual([{ method: "POST", contentType: "application/json", body: payload }]);
  });
});

describe("DELETE", () => {
  it("passes a 204 through without a body", async () => {
    server.use(
      http.delete(`${UPSTREAM}/api/v1/push/subscriptions/sub-1`, () => new HttpResponse(null, { status: 204 })),
    );

    const res = await DELETE(incoming("/api/v1/push/subscriptions/sub-1", { method: "DELETE" }));

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });
});

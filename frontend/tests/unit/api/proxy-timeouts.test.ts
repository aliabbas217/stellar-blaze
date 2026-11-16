// @vitest-environment node
import { inspect } from "node:util";
import { delay, http, HttpResponse } from "msw";
import { DELETE, GET, POST } from "@/app/api/v1/[...path]/route";
import { STOP_TIMEOUT_MS } from "@/api/queries";
import { server } from "@/mocks/node";

/*
 * The BFF holds the safety routes (Stop work and its undo or resume) to UPSTREAM_TIMEOUT_MS and every other request to
 * UPSTREAM_READ_TIMEOUT_MS. Real timers and short limits here (safety 50 ms, read 300 ms): the upstream is an MSW handler that
 * answers after a delay, and the route's own AbortSignal.timeout cuts it, so the test sees what the browser would see.
 */

const UPSTREAM = "http://upstream.test";
const PROBLEM_JSON = "application/problem+json";
const SAFETY_MS = 50;
const READ_MS = 300;
/** Between the two limits: a read waits it out, a safety request does not. */
const SLOW_MS = 150;

function incoming(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost:3000${path}`, init);
}

function answersAfter(ms: number, method: "get" | "post" | "delete" | "head", path: string, status = 200) {
  const handler = vi.fn(async () => {
    await delay(ms);
    return status === 204 ? new HttpResponse(null, { status }) : HttpResponse.json({ ok: true }, { status });
  });
  server.use(http[method](`${UPSTREAM}${path}`, handler));
  return handler;
}

beforeEach(() => {
  vi.stubEnv("API_ORIGIN", UPSTREAM);
  vi.stubEnv("UPSTREAM_TIMEOUT_MS", String(SAFETY_MS));
  vi.stubEnv("UPSTREAM_READ_TIMEOUT_MS", String(READ_MS));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a safety route is cut at its own limit", () => {
  it("Stop (POST /crews/{id}/stops) to a 150 ms upstream is cut, while a read of the same speed succeeds", async () => {
    answersAfter(SLOW_MS, "post", "/api/v1/crews/crew-a/stops", 201);
    answersAfter(SLOW_MS, "get", "/api/v1/sites");

    const stop = await POST(incoming("/api/v1/crews/crew-a/stops", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    const read = await GET(incoming("/api/v1/sites"));

    expect(stop.status).toBe(502);
    expect(stop.headers.get("content-type")).toBe(PROBLEM_JSON);
    expect(read.status).toBe(200);
  });

  it("the undo or resume (DELETE /crews/{id}/stops/{id}) is held to the safety limit too", async () => {
    answersAfter(SLOW_MS, "delete", "/api/v1/crews/crew-a/stops/stop-1", 204);

    const res = await DELETE(incoming("/api/v1/crews/crew-a/stops/stop-1", { method: "DELETE" }));

    expect(res.status).toBe(502);
  });

  it("a Stop the upstream answers inside the safety limit is passed through", async () => {
    answersAfter(5, "post", "/api/v1/crews/crew-a/stops", 201);

    const res = await POST(incoming("/api/v1/crews/crew-a/stops", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));

    expect(res.status).toBe(201);
  });

  it("the route asks fetch for exactly the safety limit on a Stop and the read limit on a read", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    answersAfter(1, "post", "/api/v1/crews/crew-a/stops", 201);
    answersAfter(1, "get", "/api/v1/sites");

    await POST(incoming("/api/v1/crews/crew-a/stops", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    await GET(incoming("/api/v1/sites"));

    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([SAFETY_MS, READ_MS]);
  });

  it("a Stop whose path is percent-encoded to the stop operation is still a safety request", async () => {
    answersAfter(SLOW_MS, "post", "/api/v1/crews/crew-a/%73tops", 201);

    const res = await POST(incoming("/api/v1/crews/crew-a/%73tops", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));

    expect(res.status).toBe(502);
  });
});

describe("everything else gets the read limit", () => {
  it("a read slower than the read limit is cut at the read limit, with the problem the UI already handles", async () => {
    answersAfter(READ_MS * 3, "get", "/api/v1/sites/site-demo-mussafah/crews");
    const started = performance.now();

    const res = await GET(incoming("/api/v1/sites/site-demo-mussafah/crews", { headers: { "x-request-id": "slow-1" } }));
    const waited = performance.now() - started;
    const body = (await res.json()) as { type: string; status: number; request_id: string };

    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toBe(PROBLEM_JSON);
    expect(body).toMatchObject({ type: "urn:stellar-blaze:problem:upstream-unavailable", status: 502, request_id: "slow-1" });
    // Cut at the read limit, not at the upstream's own 900 ms (and not at the safety limit).
    expect(waited).toBeGreaterThanOrEqual(READ_MS - 20);
    expect(waited).toBeLessThan(READ_MS * 2);
  });

  it.each([
    ["sign-off", "post", "/api/v1/crews/crew-a/day-plan/sign-off"],
    ["try a plan (validate)", "post", "/api/v1/plans/validate"],
    ["a data request", "post", "/api/v1/sites/site-demo-mussafah/data-requests"],
    ["a demo reset", "post", "/api/v1/sites/site-demo-mussafah/demo-reset"],
    ["a push registration", "post", "/api/v1/push/subscriptions"],
  ] as const)("%s is given the read limit, not the safety limit", async (_name, method, path) => {
    answersAfter(SLOW_MS, method, path);

    const res = await POST(incoming(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));

    expect(res.status).toBe(200);
  });

  it("the day plan GET and a push unsubscribe are reads too", async () => {
    answersAfter(SLOW_MS, "get", "/api/v1/crews/crew-a/day-plan");
    answersAfter(SLOW_MS, "delete", "/api/v1/push/subscriptions/sub-1", 204);

    expect((await GET(incoming("/api/v1/crews/crew-a/day-plan"))).status).toBe(200);
    expect((await DELETE(incoming("/api/v1/push/subscriptions/sub-1", { method: "DELETE" }))).status).toBe(204);
  });
});

describe("with neither variable set", () => {
  it("both limits are 10 s, and the client's Stop limit is still below the safety one", async () => {
    vi.stubEnv("UPSTREAM_TIMEOUT_MS", undefined);
    vi.stubEnv("UPSTREAM_READ_TIMEOUT_MS", "");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    answersAfter(1, "post", "/api/v1/crews/crew-a/stops", 201);
    answersAfter(1, "get", "/api/v1/sites");

    await POST(incoming("/api/v1/crews/crew-a/stops", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    await GET(incoming("/api/v1/sites"));

    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([10_000, 10_000]);
    // The phone gives up on a Stop (8 s) before the BFF does (10 s), so the safety path has one clock the person can see.
    expect(STOP_TIMEOUT_MS).toBeLessThan(10_000);
  });
});

/** The `signal` of every call the route made to fetch (the real fetch still runs, so MSW still answers). */
function fetchSignals(): AbortSignal[] {
  const real = globalThis.fetch;
  const signals: AbortSignal[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (init?.signal) signals.push(init.signal);
    return real(input, init);
  });
  return signals;
}

/** A request whose client goes away `ms` after it is made (the browser tab closed, the connection dropped). */
function disconnectingAfter(ms: number, path: string, init: RequestInit = {}): Request {
  const client = new AbortController();
  setTimeout(() => {
    client.abort();
  }, ms);
  return new Request(`http://localhost:3000${path}`, { ...init, signal: client.signal });
}

describe("a client that goes away", () => {
  it.each(["GET", "HEAD"])("a %s read: the upstream call is aborted with it, so a hung read does not hold the API", async (method) => {
    const signals = fetchSignals();
    const upstream = answersAfter(READ_MS * 2, method === "HEAD" ? "head" : "get", "/api/v1/sites/site-demo-mussafah/crews");
    const started = performance.now();

    await GET(disconnectingAfter(20, "/api/v1/sites/site-demo-mussafah/crews", { method }));
    const waited = performance.now() - started;

    expect(upstream).toHaveBeenCalled();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    // Answered at the disconnect, not at the read limit (300 ms) and not at the upstream's 600 ms.
    expect(waited).toBeLessThan(READ_MS - 50);
  });

  it("a read the client waits for still ends at the read limit (the timeout is not lost to the combined signal)", async () => {
    const signals = fetchSignals();
    answersAfter(READ_MS * 3, "get", "/api/v1/sites");

    const res = await GET(incoming("/api/v1/sites"));

    expect(res.status).toBe(502);
    expect(signals[0]?.aborted).toBe(true);
    expect((signals[0]?.reason as { name?: string } | undefined)?.name).toBe("TimeoutError");
  });

  // A Stop or a sign-off in flight must reach the API even if the phone loses its connection a moment after pressing it:
  // aborting it on a disconnect would leave the person not knowing whether it was recorded. Only their own limit may cut them.
  it.each([
    ["a Stop (POST)", "post", "/api/v1/crews/crew-a/stops", 201],
    ["the undo or resume of a Stop (DELETE)", "delete", "/api/v1/crews/crew-a/stops/stop-1", 204],
    ["a sign-off (POST)", "post", "/api/v1/crews/crew-a/day-plan/sign-off", 200],
    ["try a plan (POST)", "post", "/api/v1/plans/validate", 200],
    ["a data request (POST)", "post", "/api/v1/sites/site-demo-mussafah/data-requests", 200],
  ] as const)("%s keeps going after the client disconnects", async (_name, method, path, status) => {
    vi.stubEnv("UPSTREAM_TIMEOUT_MS", String(READ_MS));
    const signals = fetchSignals();
    const upstream = answersAfter(80, method, path, status);
    const handler = method === "delete" ? DELETE : POST;

    const res = await handler(
      disconnectingAfter(20, path, { method: method.toUpperCase(), ...(method === "post" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}) }),
    );

    expect(upstream).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(status);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
  });
});

describe("what a failed upstream call writes to the log", () => {
  /** Everything console.error received, printed to unlimited depth as a developer would see it. */
  function logged(): string {
    return inspect(vi.mocked(console.error).mock.calls, { depth: null });
  }

  it("a timeout logs the cause's name and message and the request id, not the whole DOMException", async () => {
    answersAfter(READ_MS * 3, "get", "/api/v1/sites");

    await GET(incoming("/api/v1/sites", { headers: { "x-request-id": "log-1" } }));

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("bff: upstream unavailable", {
      request_id: "log-1",
      reason: "request to the API failed",
      cause: { name: "TimeoutError", message: expect.stringContaining("timeout") as unknown },
    });
    // The whole error object has a stack, a numeric code and a constants table; none of it is logged.
    expect(logged()).not.toMatch(/\bat .*\(|stack|INDEX_SIZE_ERR|DOMException \{/);
    // The whole DOMException printed about 30 constant lines; this is the same record in about a dozen.
    expect(logged().split("\n").length).toBeLessThan(20);
  });

  it("a connection failure logs its own cause one level down, still only as name and message", async () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), { code: "ECONNREFUSED", errno: -111 });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: refused }));

    await GET(incoming("/api/v1/sites", { headers: { "x-request-id": "log-2" } }));

    expect(console.error).toHaveBeenCalledWith("bff: upstream unavailable", {
      request_id: "log-2",
      reason: "request to the API failed",
      cause: { name: "TypeError", message: "fetch failed", cause: { name: "Error", message: "connect ECONNREFUSED 10.0.0.1:443" } },
    });
    expect(logged()).not.toMatch(/errno|-111|stack/);
  });

  it("logs nothing about a thrown value that is not an Error (it could be anything)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue({ secret: "carried-by-a-plain-object" });

    await GET(incoming("/api/v1/sites", { headers: { "x-request-id": "log-3" } }));

    expect(console.error).toHaveBeenCalledWith("bff: upstream unavailable", { request_id: "log-3", reason: "request to the API failed" });
    expect(logged()).not.toContain("carried-by-a-plain-object");
  });

  it("never logs the employer token or a client credential, on the paths that carry the token", async () => {
    vi.stubEnv("DEMO_EMPLOYER_TOKEN", "employer-token-0123456789");
    answersAfter(READ_MS * 3, "post", "/api/v1/crews/crew-a/day-plan/sign-off");
    const headers = { "content-type": "application/json", authorization: "Bearer client-credential-abcdef", cookie: "sid=cookie-value-xyz", "x-request-id": "log-4" };

    await POST(incoming("/api/v1/crews/crew-a/day-plan/sign-off", { method: "POST", headers, body: "{}" }));

    expect(console.error).toHaveBeenCalledTimes(1);
    const text = logged();
    for (const secret of ["employer-token-0123456789", "client-credential-abcdef", "cookie-value-xyz", "Bearer", "authorization"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("a bad limit is logged by its message (the reason), once, with no error object behind it", async () => {
    vi.stubEnv("UPSTREAM_READ_TIMEOUT_MS", "120001");

    await GET(incoming("/api/v1/sites", { headers: { "x-request-id": "log-5" } }));

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("bff: upstream unavailable", {
      request_id: "log-5",
      reason: expect.stringContaining("UPSTREAM_READ_TIMEOUT_MS") as unknown,
    });
  });
});

describe("a bad value is an error on first use, never a default", () => {
  it.each([
    ["UPSTREAM_TIMEOUT_MS", "10s"],
    ["UPSTREAM_READ_TIMEOUT_MS", "120001"],
  ])("%s=%s: the request is not forwarded and the log names the variable", async (name, value) => {
    vi.stubEnv(name, value);
    const upstream = answersAfter(1, "get", "/api/v1/sites");

    const res = await GET(incoming("/api/v1/sites", { headers: { "x-request-id": "bad-env" } }));

    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toBe(PROBLEM_JSON);
    expect(upstream).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "bff: upstream unavailable",
      expect.objectContaining({ request_id: "bad-env", reason: expect.stringContaining(name) as unknown }),
    );
  });

  it("a Stop is refused too (no silent fall back to a limit nobody chose)", async () => {
    vi.stubEnv("UPSTREAM_TIMEOUT_MS", "0");
    const upstream = answersAfter(1, "post", "/api/v1/crews/crew-a/stops", 201);

    const res = await POST(incoming("/api/v1/crews/crew-a/stops", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));

    expect(res.status).toBe(502);
    expect(upstream).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
import { SCENARIOS } from "../../e2e/helpers/scenario";
import { SLOW_READ_MS, SLOW_STOP_MS } from "@/mocks/handlers";

/*
 * The `slow` scenario of the mock API, for the e2e that proves the BFF's long read limit and the "waking up" line: a cold API.
 * Every request that is not a Stop waits SLOW_READ_MS before it answers normally, and a Stop (create or undo) waits SLOW_STOP_MS,
 * far past any safety limit, so the BFF's own safety clock is what ends it. Fake timers hold the wait: nothing here sleeps.
 */

const ORIGIN = "http://mock.test";
const EMPLOYER = { authorization: "Bearer demo-token" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

/** True once `promise` has settled, without waiting for it. */
function trackSettled(promise: Promise<unknown>): { readonly settled: () => boolean } {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  return { settled: () => done };
}

function request(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-sb-mock-scenario": "slow", ...EMPLOYER },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("the slow scenario", () => {
  it("is a scenario the e2e helper can name", () => {
    expect(SCENARIOS).toContain("slow");
  });

  it("holds a read for SLOW_READ_MS (longer than the 3 s the waking line waits, shorter than the read limit), then answers normally", async () => {
    expect(SLOW_READ_MS).toBeGreaterThan(3_000);
    expect(SLOW_READ_MS).toBeLessThan(10_000);
    const pending = request("GET", "/api/v1/sites");
    const watch = trackSettled(pending);

    await vi.advanceTimersByTimeAsync(SLOW_READ_MS - 1);
    expect(watch.settled()).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(((await res.json()) as unknown[]).length).toBeGreaterThan(0);
  });

  it("holds a write that is not a Stop (sign-off, try a plan) the same way", async () => {
    const pending = request("POST", "/api/v1/plans/validate", { nothing: "valid" });
    const watch = trackSettled(pending);

    await vi.advanceTimersByTimeAsync(SLOW_READ_MS - 1);
    expect(watch.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    // The body is not a valid request, so the answer is the mock's 422: the point is that it came after the wait.
    expect((await pending).status).toBeGreaterThanOrEqual(400);
  });

  it("holds a Stop and its undo for SLOW_STOP_MS, far past any safety limit", async () => {
    expect(SLOW_STOP_MS).toBeGreaterThanOrEqual(15_000);
    const stop = request("POST", "/api/v1/crews/crew-a/stops", {});
    const clear = request("DELETE", "/api/v1/crews/crew-a/stops/stop-1");
    const watchStop = trackSettled(stop);
    const watchClear = trackSettled(clear);

    await vi.advanceTimersByTimeAsync(SLOW_READ_MS + 1_000);
    expect(watchStop.settled()).toBe(false);
    expect(watchClear.settled()).toBe(false);

    await vi.advanceTimersByTimeAsync(SLOW_STOP_MS);
    // Late, it answers 500 and changes nothing: a stop the BFF gave up on must never land afterwards.
    expect((await stop).status).toBe(500);
    expect((await clear).status).toBe(500);
  });

  it("never creates a stop, even after the wait", async () => {
    vi.useRealTimers();
    const before = await fetch(`${ORIGIN}/api/v1/sites/site-demo-mussafah/crews`);
    const crewsBefore = (await before.json()) as { id: string; stopped: boolean }[];
    expect(crewsBefore.find((crew) => crew.id === "crew-a")?.stopped).toBe(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const stop = request("POST", "/api/v1/crews/crew-a/stops", {});
    await vi.advanceTimersByTimeAsync(SLOW_STOP_MS);
    await stop;
    vi.useRealTimers();

    const after = await fetch(`${ORIGIN}/api/v1/sites/site-demo-mussafah/crews`);
    expect(((await after.json()) as { id: string; stopped: boolean }[]).find((crew) => crew.id === "crew-a")?.stopped).toBe(false);
  });

  it("does nothing to a request without the header", async () => {
    const res = await fetch(`${ORIGIN}/api/v1/sites`);

    expect(res.status).toBe(200);
  });
});

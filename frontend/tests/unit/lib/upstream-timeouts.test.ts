// @vitest-environment node
import { CLEAR_STOP_TIMEOUT_MS, STOP_TIMEOUT_MS } from "@/api/queries";
import {
  DEFAULT_TIMEOUT_MS,
  MAX_READ_TIMEOUT_MS,
  MAX_SAFETY_TIMEOUT_MS,
  READ_TIMEOUT_VAR,
  SAFETY_TIMEOUT_VAR,
  isSafetyRoute,
  pathSegmentsOf,
  resolveUpstreamTimeouts,
} from "@/lib/upstream-timeouts";

/*
 * The BFF's two upstream time limits (UPSTREAM_TIMEOUT_MS for the safety routes, UPSTREAM_READ_TIMEOUT_MS for everything else):
 * how the environment is parsed, and which request is a safety request. A bad value is never replaced by a default: it throws
 * a message that names the variable, the value and the range, so a mistyped deployment stops instead of running with a limit
 * nobody chose.
 */

describe("the variable names (the hosting lane's Bicep uses these)", () => {
  it("are fixed", () => {
    expect(SAFETY_TIMEOUT_VAR).toBe("UPSTREAM_TIMEOUT_MS");
    expect(READ_TIMEOUT_VAR).toBe("UPSTREAM_READ_TIMEOUT_MS");
  });

  it("the bounds are 1 to 15000 ms for the safety limit and 1 to 120000 ms for reads; both defaults are 10 s", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
    expect(MAX_SAFETY_TIMEOUT_MS).toBe(15_000);
    expect(MAX_READ_TIMEOUT_MS).toBe(120_000);
  });

  // The safety cap is the phone's own longest safety wait (the undo), so no configuration can make a Stop wait longer than the app
  // already allows a safety request to; the default sits above the phone's Stop limit (the phone gives up first, so a failed Stop has
  // one clock the person can see) and not above the cap.
  it("the safety cap equals the client's longest safety limit (CLEAR_STOP_TIMEOUT_MS), imported, not retyped", () => {
    expect(MAX_SAFETY_TIMEOUT_MS).toBe(CLEAR_STOP_TIMEOUT_MS);
  });

  it("the default safety limit stays above the client's Stop limit and not above the cap", () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(STOP_TIMEOUT_MS);
    expect(DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(MAX_SAFETY_TIMEOUT_MS);
  });
});

describe("resolveUpstreamTimeouts", () => {
  it("defaults both to 10 s when neither is set", () => {
    expect(resolveUpstreamTimeouts({})).toEqual({ safetyMs: 10_000, readMs: 10_000 });
  });

  it.each([[""], [undefined]])("treats %j as not set, like APP_VERSION", (raw) => {
    expect(resolveUpstreamTimeouts({ UPSTREAM_TIMEOUT_MS: raw, UPSTREAM_READ_TIMEOUT_MS: raw })).toEqual({ safetyMs: 10_000, readMs: 10_000 });
  });

  it("reads each variable on its own", () => {
    expect(resolveUpstreamTimeouts({ UPSTREAM_READ_TIMEOUT_MS: "45000" })).toEqual({ safetyMs: 10_000, readMs: 45_000 });
    expect(resolveUpstreamTimeouts({ UPSTREAM_TIMEOUT_MS: "4000" })).toEqual({ safetyMs: 4_000, readMs: 10_000 });
  });

  it.each([["1", 1], ["15000", 15_000], ["9", 9], ["4000", 4_000]])("accepts %s for both variables", (raw, ms) => {
    expect(resolveUpstreamTimeouts({ UPSTREAM_TIMEOUT_MS: raw, UPSTREAM_READ_TIMEOUT_MS: raw })).toEqual({ safetyMs: ms, readMs: ms });
  });

  it.each([["45000", 45_000], ["120000", 120_000]])("accepts %s for the read variable", (raw, ms) => {
    expect(resolveUpstreamTimeouts({ UPSTREAM_READ_TIMEOUT_MS: raw }).readMs).toBe(ms);
  });

  // The shapes the brief names, plus the ones a deployment template can plausibly produce.
  const invalid = [
    "10s",
    "1e4",
    "0x10",
    " 5000 ",
    "5000 ",
    " ",
    "-1",
    "+5",
    "0",
    "00",
    "12.5",
    "5000.0",
    "NaN",
    "Infinity",
    "99999999999999999999",
    "010000",
    "1_000",
    "1,000",
    "٤٥٠٠٠",
    "null",
  ];

  const escaped = (raw: string) => JSON.stringify(raw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  it.each(invalid)("rejects UPSTREAM_TIMEOUT_MS=%j, naming the variable, the value and its range (1 to 15000)", (raw) => {
    expect(() => resolveUpstreamTimeouts({ UPSTREAM_TIMEOUT_MS: raw })).toThrow(
      new RegExp(`UPSTREAM_TIMEOUT_MS=${escaped(raw)} is not allowed.*from 1 to 15000`),
    );
  });

  it.each(invalid)("rejects UPSTREAM_READ_TIMEOUT_MS=%j, naming the variable, the value and its range (1 to 120000)", (raw) => {
    expect(() => resolveUpstreamTimeouts({ UPSTREAM_READ_TIMEOUT_MS: raw })).toThrow(
      new RegExp(`UPSTREAM_READ_TIMEOUT_MS=${escaped(raw)} is not allowed.*from 1 to 120000`),
    );
  });

  // The safety variable has its own, lower upper bound: a Stop must never be allowed to wait as long as a cold-start read.
  it("15000 is the last safety value and 15001 the first one refused, with the variable name and its range in the message", () => {
    expect(resolveUpstreamTimeouts({ UPSTREAM_TIMEOUT_MS: "15000" }).safetyMs).toBe(15_000);
    expect(() => resolveUpstreamTimeouts({ UPSTREAM_TIMEOUT_MS: "15001" })).toThrow(/UPSTREAM_TIMEOUT_MS="15001".*from 1 to 15000/);
  });

  it("a safety value of 120000, once legal, is now refused (the cap is not the read bound)", () => {
    expect(() => resolveUpstreamTimeouts({ UPSTREAM_TIMEOUT_MS: "120000" })).toThrow(/UPSTREAM_TIMEOUT_MS="120000".*from 1 to 15000/);
  });

  it("the read variable keeps its own bound: 120000 accepted, 120001 refused with its range", () => {
    expect(resolveUpstreamTimeouts({ UPSTREAM_READ_TIMEOUT_MS: "120000" }).readMs).toBe(120_000);
    expect(() => resolveUpstreamTimeouts({ UPSTREAM_READ_TIMEOUT_MS: "120001" })).toThrow(/UPSTREAM_READ_TIMEOUT_MS="120001".*from 1 to 120000/);
  });

  it("the message of one variable does not quote the other's range", () => {
    expect(() => resolveUpstreamTimeouts({ UPSTREAM_TIMEOUT_MS: "15001" })).not.toThrow(/120000/);
  });

  it("names every bad variable in one message, so one restart fixes them all", () => {
    expect(() => resolveUpstreamTimeouts({ UPSTREAM_TIMEOUT_MS: "x", UPSTREAM_READ_TIMEOUT_MS: "y" })).toThrow(
      /UPSTREAM_TIMEOUT_MS[\s\S]*UPSTREAM_READ_TIMEOUT_MS/,
    );
  });

  it("a bad safety value is not rescued by a good read value", () => {
    expect(() => resolveUpstreamTimeouts({ UPSTREAM_TIMEOUT_MS: "10s", UPSTREAM_READ_TIMEOUT_MS: "45000" })).toThrow(/UPSTREAM_TIMEOUT_MS/);
  });
});

describe("pathSegmentsOf", () => {
  it("splits a pathname and drops empty segments", () => {
    expect(pathSegmentsOf("/api/v1/crews/crew-a/stops")).toEqual(["api", "v1", "crews", "crew-a", "stops"]);
    expect(pathSegmentsOf("/api/v1//crews/crew-a/stops/")).toEqual(["api", "v1", "crews", "crew-a", "stops"]);
  });

  it("decodes percent-encoding first, because the API routes on the decoded path", () => {
    expect(pathSegmentsOf("/api/v1/crews/crew-a/%73tops")).toEqual(["api", "v1", "crews", "crew-a", "stops"]);
    expect(pathSegmentsOf("/api/v1/crews/crew-a%2Fstops")).toEqual(["api", "v1", "crews", "crew-a", "stops"]);
  });

  it("keeps the raw path when it is not valid percent-encoding", () => {
    expect(pathSegmentsOf("/api/v1/crews/crew-a/stops%zz")).toEqual(["api", "v1", "crews", "crew-a", "stops%zz"]);
  });
});

describe("isSafetyRoute", () => {
  const segs = (path: string) => pathSegmentsOf(path);

  it("is true for Stop (POST /crews/{id}/stops) and for its undo or resume (DELETE /crews/{id}/stops/{id})", () => {
    expect(isSafetyRoute("POST", segs("/api/v1/crews/crew-a/stops"))).toBe(true);
    expect(isSafetyRoute("DELETE", segs("/api/v1/crews/crew-a/stops/stop-1"))).toBe(true);
  });

  it("does not depend on the crew id (a deployment is not limited to the demo crews)", () => {
    expect(isSafetyRoute("POST", segs("/api/v1/crews/3f9c0e1a-7b52-4d11-9a3e-0c1d2e3f4a5b/stops"))).toBe(true);
  });

  it("is case-insensitive on the method, as fetch normalizes it", () => {
    expect(isSafetyRoute("post", segs("/api/v1/crews/crew-a/stops"))).toBe(true);
    expect(isSafetyRoute("delete", segs("/api/v1/crews/crew-a/stops/s"))).toBe(true);
  });

  it("is true through percent-encoding and a trailing slash (fail toward the short limit)", () => {
    expect(isSafetyRoute("POST", segs("/api/v1/crews/crew-a/%73tops"))).toBe(true);
    expect(isSafetyRoute("POST", segs("/api/v1/crews/crew-a%2Fstops"))).toBe(true);
    expect(isSafetyRoute("POST", segs("/api/v1/crews/crew-a/stops/"))).toBe(true);
  });

  it.each([
    ["GET", "/api/v1/crews/crew-a/stops"],
    ["GET", "/api/v1/crews/crew-a/stops/stop-1"],
    ["POST", "/api/v1/crews/crew-a/stops/stop-1"],
    ["DELETE", "/api/v1/crews/crew-a/stops"],
    ["PUT", "/api/v1/crews/crew-a/stops"],
    ["POST", "/api/v1/crews/crew-a/day-plan/sign-off"],
    ["GET", "/api/v1/crews/crew-a/day-plan"],
    ["GET", "/api/v1/crews/crew-a/timeline"],
    ["POST", "/api/v1/plans/validate"],
    ["POST", "/api/v1/sites/site-demo-mussafah/data-requests"],
    ["POST", "/api/v1/sites/site-demo-mussafah/demo-reset"],
    ["POST", "/api/v1/push/subscriptions"],
    ["DELETE", "/api/v1/push/subscriptions/sub-1"],
    ["GET", "/api/v1/sites"],
    ["POST", "/api/v1/sites/site-demo-mussafah/stops"],
    ["POST", "/api/v1/crews/crew-a/stops/stop-1/extra"],
    ["POST", "/api/v1/crews/stops"],
    ["DELETE", "/api/v1/crews/stops/stop-1"],
  ])("is false for %s %s", (method, path) => {
    expect(isSafetyRoute(method, segs(path))).toBe(false);
  });
});

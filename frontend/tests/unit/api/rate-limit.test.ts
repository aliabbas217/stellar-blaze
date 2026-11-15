// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  GENERAL_CEILING_PER_MIN,
  LIMIT_WINDOW_MS,
  STOP_RESERVE_PER_MIN,
  UPSTREAM_WINDOW_MARGIN_MS,
  UPSTREAM_QUOTA_PER_MIN,
  clientKey,
  createRateLimiter,
  resolveLimits,
  trustedProxyHops,
} from "@/app/api/v1/[...path]/rate-limit";

/* The token bucket behind the BFF write limit, driven by an injected clock: no timers, no sleeping. */

function limiter(perMinute: number, maxKeys?: number, windowMs?: number) {
  const clock = { now: 1_000_000 };
  const instance = createRateLimiter({
    perMinute,
    now: () => clock.now,
    ...(maxKeys === undefined ? {} : { maxKeys }),
    ...(windowMs === undefined ? {} : { windowMs }),
  });
  return { clock, ...instance };
}

const WINDOW = 60_000;

/** The most admissions in any window of `lengthMs`, closed at both ends, over ascending admission times. */
function maxInAnyWindow(times: readonly number[], lengthMs: number): number {
  let best = 0;
  let from = 0;
  times.forEach((time, index) => {
    while ((times[from] ?? Number.POSITIVE_INFINITY) < time - lengthMs) from += 1;
    best = Math.max(best, index - from + 1);
  });
  return best;
}

describe("createRateLimiter", () => {
  it("admits N, then refuses until the oldest admission leaves the window, with a Retry-After in whole seconds", () => {
    const { take, peek } = limiter(3);

    expect([take("a"), take("a"), take("a"), take("a")]).toEqual([true, true, true, false]);
    expect(peek("a")).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("slides: a slot opens exactly when the oldest admission is one window old, not before, and not all at once", () => {
    const { clock, take, peek } = limiter(3);
    const start = clock.now;
    take("a");
    clock.now = start + 20_000;
    take("a");
    clock.now = start + 40_000;
    take("a");

    clock.now = start + WINDOW - 1;
    expect(peek("a")).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(take("a")).toBe(false);
    clock.now = start + WINDOW;
    expect(peek("a").allowed).toBe(true);
    expect(take("a")).toBe(true);
    // The other two are still inside the window: one slot opened, no more.
    expect(take("a")).toBe(false);
    clock.now = start + WINDOW + 20_000;
    expect(take("a")).toBe(true);
    expect(take("a")).toBe(false);
  });

  it("never admits more than N in any window, however the requests are spaced (checked over 5 minutes of irregular traffic)", () => {
    for (const limit of [1, 3, 20, 40]) {
      const { clock, take } = limiter(limit);
      const admitted: number[] = [];
      let seed = 12345;
      const next = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const end = clock.now + 5 * WINDOW;
      while (clock.now < end) {
        // Bursts and pauses: 0 to 3 s between requests, sometimes none at all.
        clock.now += next() < 0.3 ? 0 : Math.floor(next() * 3000);
        if (take("a")) admitted.push(clock.now);
      }

      expect(maxInAnyWindow(admitted, WINDOW - 1), `limit ${String(limit)}`).toBeLessThanOrEqual(limit);
      expect(admitted.length, `limit ${String(limit)} admits something`).toBeGreaterThan(limit);
    }
  });

  it("keeps a counter per key", () => {
    const { take } = limiter(1);

    expect([take("a"), take("b"), take("a"), take("b")]).toEqual([true, true, false, false]);
  });

  it("peek changes nothing", () => {
    const { take, peek } = limiter(1);

    for (let i = 0; i < 5; i += 1) expect(peek("a").allowed).toBe(true);
    expect(take("a")).toBe(true);
    expect(peek("a").allowed).toBe(false);
  });

  it("holds at most maxKeys keys: keys with nothing in the window go first, then the oldest", () => {
    const { clock, take } = limiter(1, 3);
    take("a");
    take("b");
    take("c");
    // All three are active; a new key must not be refused and memory stays bounded.
    expect(take("d")).toBe(true);
    // The oldest key ("a") was dropped, so it starts empty again; "d" is still counted.
    expect(take("a")).toBe(true);
    expect(take("d")).toBe(false);

    clock.now += WINDOW;
    expect(take("e")).toBe(true);
  });
});

describe("the limits as the BFF builds them: the window is the upstream's plus a margin", () => {
  it("is 61 s, so two admissions 60 s apart are still counted together", () => {
    expect(LIMIT_WINDOW_MS).toBe(60_000 + UPSTREAM_WINDOW_MARGIN_MS);
    const { clock, take } = limiter(1, undefined, LIMIT_WINDOW_MS);
    expect(take("a")).toBe(true);
    clock.now += 60_000;
    expect(take("a")).toBe(false);
    clock.now += UPSTREAM_WINDOW_MARGIN_MS;
    expect(take("a")).toBe(true);
  });
});

describe("clientKey", () => {
  const header = (value: string) => new Headers({ "x-forwarded-for": value });

  it("with one trusted proxy (the default) is the last entry, the one the ingress appended", () => {
    expect(clientKey(header("6.6.6.6, 203.0.113.7"))).toBe("203.0.113.7");
    expect(clientKey(header("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("with two trusted proxies is the second entry from the right, so a CDN hop in front does not share one bucket", () => {
    // client 203.0.113.7 -> CDN (appends the client) -> ingress (appends the CDN) -> app; the caller wrote 6.6.6.6.
    expect(clientKey(header("6.6.6.6, 203.0.113.7, 198.51.100.9"), 2)).toBe("203.0.113.7");
    expect(clientKey(header("203.0.113.7, 198.51.100.9"), 2)).toBe("203.0.113.7");
    // With the wrong assumption (one hop) every visitor would share the CDN address:
    expect(clientKey(header("203.0.113.7, 198.51.100.9"), 1)).toBe("198.51.100.9");
  });

  it("ignores what the caller prepended: rotating the leftmost entries does not change the key", () => {
    expect(clientKey(header("1.1.1.1, 203.0.113.7"))).toBe(clientKey(header("2.2.2.2, 203.0.113.7")));
  });

  it("shares one bucket when the header is missing, empty, shorter than the hops, or no proxy is trusted", () => {
    expect(clientKey(new Headers())).toBe("unknown");
    expect(clientKey(header(" "))).toBe("unknown");
    expect(clientKey(header("203.0.113.7"), 2)).toBe("unknown");
    expect(clientKey(header("203.0.113.7"), 0)).toBe("unknown");
  });
});

describe("trustedProxyHops", () => {
  it("is 1 when unset or invalid, and the number otherwise (0 means none is trusted)", () => {
    expect(trustedProxyHops(undefined)).toBe(1);
    expect(trustedProxyHops("two")).toBe(1);
    expect(trustedProxyHops("-1")).toBe(1);
    expect(trustedProxyHops("1.5")).toBe(1);
    expect(trustedProxyHops("2")).toBe(2);
    expect(trustedProxyHops("0")).toBe(0);
  });

  it("is the default 1 for a blank or whitespace value, which Number() would read as 0", () => {
    expect(trustedProxyHops("")).toBe(1);
    expect(trustedProxyHops(" ")).toBe(1);
    expect(trustedProxyHops("\t\n")).toBe(1);
    expect(trustedProxyHops(" 2 ")).toBe(2);
  });
});

interface SpecOperation {
  operationId: string;
  security?: unknown[];
  "x-rate-limit"?: { bucket?: string; limit: number; window_seconds: number }[];
}

function employerOperations(): SpecOperation[] {
  const spec = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../openapi/stellar-blaze.openapi.json"), "utf8")) as {
    paths: Record<string, Record<string, SpecOperation>>;
  };
  return Object.values(spec.paths)
    .flatMap((item) => Object.values(item))
    .filter((operation) => (operation.security?.length ?? 0) > 0);
}

/** The strictest per-minute equivalent of some limits: a limit L per W seconds is L / W * 60 a minute. */
function strictestPerMinute(operationId: string, windows: { limit: number; window_seconds: number }[]): number {
  if (windows.length === 0) throw new Error(`${operationId} lists no x-rate-limit`);
  return Math.min(...windows.map((entry) => (entry.limit / entry.window_seconds) * 60));
}

/**
 * What the contract allows, per minute, from `x-rate-limit`.
 *
 * - `stop` is the named bucket "stop" (create_crew_stop; B3: "no other limit can block it"), counting every window the
 *   operations in it list.
 * - `shared` is the strictest of the unnamed limits of the employer operations that make up the shared pool: every
 *   employer operation's windows without a bucket, demo-reset aside. delete_crew_stop is in it (it names no bucket).
 * - `reset` is demo-reset's own: it lists 1 per 60 s AND 10 per 3600 s, strictest 10 an hour, much tighter than the
 *   pool. The BFF cannot be held to it (it keeps no counter for reset besides the general one) and upstream enforces it
 *   with its own 429; it is read here so that a change to it shows up, and so that it is never mistaken for the pool's quota.
 */
function contractQuotas(): { shared: number; stop: number; reset: number } {
  const operations = employerOperations();
  const reset = operations.find((operation) => operation.operationId === "reset_demo_site");
  if (reset === undefined) throw new Error("the contract has no reset_demo_site");
  const windows = (operation: SpecOperation, bucket: string | undefined) =>
    (operation["x-rate-limit"] ?? []).filter((entry) => entry.bucket === bucket);
  const stopWindows = operations.flatMap((operation) => windows(operation, "stop"));
  const shared = operations
    .filter((operation) => operation !== reset && windows(operation, undefined).length > 0)
    .map((operation) => strictestPerMinute(operation.operationId, windows(operation, undefined)));
  return {
    shared: Math.min(...shared),
    stop: strictestPerMinute("the stop bucket", stopWindows),
    reset: strictestPerMinute(reset.operationId, windows(reset, undefined)),
  };
}

function contractQuotaPerMinute(): number {
  return contractQuotas().shared;
}

describe("the BFF write limits against the contract's upstream quota", () => {
  /** The environment an operator (or an attacker with config access) could set: everything enormous. */
  const HUGE = {
    DEMO_WRITE_RATE_PER_MIN: "1000000",
    DEMO_WRITE_GLOBAL_RATE_PER_MIN: "1000000",
    DEMO_STOP_RATE_PER_MIN: "1000000",
    DEMO_STOP_GLOBAL_RATE_PER_MIN: "1000000",
  };

  it("reads a quota from the contract, not from a constant of ours", () => {
    expect(contractQuotaPerMinute()).toBeGreaterThan(0);
    expect(Number.isFinite(contractQuotaPerMinute())).toBe(true);
  });

  it.each([
    ["the defaults", {}],
    ["enormous values (clamped)", HUGE],
    ["invalid and blank values", { DEMO_WRITE_GLOBAL_RATE_PER_MIN: "many", DEMO_STOP_GLOBAL_RATE_PER_MIN: " ", DEMO_WRITE_RATE_PER_MIN: "-3", DEMO_STOP_RATE_PER_MIN: "0" }],
  ])("%s: the general and stop buckets add up to no more than the upstream quota", (_name, env) => {
    const limits = resolveLimits(env);

    expect(limits.general.global + limits.stop.global).toBeLessThanOrEqual(contractQuotaPerMinute());
    expect(UPSTREAM_QUOTA_PER_MIN).toBeLessThanOrEqual(contractQuotaPerMinute());
  });

  it("reads the stop bucket from the contract: create_crew_stop has its own, the BFF's stop reserve fits inside it and is not what the pool arithmetic counts on", () => {
    const { stop, shared } = contractQuotas();

    const bucketOf = (id: string) => employerOperations().find((operation) => operation.operationId === id)?.["x-rate-limit"]?.map((entry) => entry.bucket);
    expect(bucketOf("create_crew_stop")).toEqual(["stop"]);
    // Clearing a stop names no bucket, so it draws on the shared pool: the reserve is counted against the pool as if all clears.
    expect(bucketOf("delete_crew_stop")).toEqual([undefined]);
    expect(stop).toBe(30);
    expect(stop).toBeLessThan(shared);
    // A stop creation never draws on the shared pool, so its bucket only has to hold the BFF's whole stop class.
    expect(resolveLimits({}).stop.global).toBeLessThanOrEqual(stop);
    expect(resolveLimits(HUGE).stop.global).toBeLessThanOrEqual(stop);
    expect(STOP_RESERVE_PER_MIN).toBeLessThanOrEqual(stop);
  });

  it("keeps a reserve for Stop work that general traffic can never claim, and a per-client limit never above its bucket", () => {
    for (const env of [{}, HUGE]) {
      const limits = resolveLimits(env);
      expect(limits.stop.global).toBeGreaterThanOrEqual(1);
      expect(limits.general.global).toBeLessThanOrEqual(GENERAL_CEILING_PER_MIN);
      expect(limits.general.global + STOP_RESERVE_PER_MIN).toBeLessThanOrEqual(UPSTREAM_QUOTA_PER_MIN);
      expect(limits.stop.perClient).toBeLessThanOrEqual(limits.stop.global);
      expect(limits.general.perClient).toBeLessThanOrEqual(limits.general.global);
    }
  });

  it("has the documented defaults: general 20 per client and 40 global, stop 10 per client and 20 global", () => {
    expect(resolveLimits({})).toEqual({ general: { perClient: 20, global: 40 }, stop: { perClient: 10, global: 20 } });
  });

  it("clamps what the environment asks for and lets it lower the rest", () => {
    expect(resolveLimits(HUGE)).toEqual({ general: { perClient: 40, global: 40 }, stop: { perClient: 20, global: 20 } });
    expect(resolveLimits({ DEMO_WRITE_GLOBAL_RATE_PER_MIN: "5", DEMO_STOP_GLOBAL_RATE_PER_MIN: "3" })).toEqual({
      general: { perClient: 5, global: 5 },
      stop: { perClient: 3, global: 3 },
    });
  });
  it("treats demo-reset's own, tighter limit as separate: it is below the pool's quota and enforced upstream", () => {
    const { shared, reset } = contractQuotas();

    expect(reset).toBeLessThan(shared);
    expect(reset).toBeCloseTo(10 / 60, 5);
  });

  /** A token bucket (capacity N, refill N a minute), the structure this limiter replaced, as a reference for the measure. */
  function tokenBucketAdmissions(perMinute: number, stepMs: number, totalMs: number): number[] {
    let tokens = perMinute;
    const admitted: number[] = [];
    for (let at = 0; at <= totalMs; at += stepMs) {
      tokens = Math.min(perMinute, tokens + (perMinute / 60_000) * stepMs);
      if (tokens >= 1) {
        tokens -= 1;
        admitted.push(at);
      }
    }
    return admitted;
  }

  it("the measure is not vacuous: a token bucket driven the same way admits well over its limit in a 60 s window", () => {
    const admitted = tokenBucketAdmissions(40, 100, 180_000);

    expect(maxInAnyWindow(admitted, 60_000)).toBeGreaterThan(70);
  });

  it.each([
    ["the defaults", {}],
    ["enormous environment values, clamped", HUGE],
  ])("driven flat out every 100 ms for 3 minutes (%s), general plus stop never admit more than the contract quota in ANY 60 s window", (_name, env) => {
    const limits = resolveLimits(env);
    const clock = { now: 0 };
    const make = (perMinute: number) => createRateLimiter({ perMinute, now: () => clock.now, windowMs: LIMIT_WINDOW_MS });
    const general = make(limits.general.global);
    const stop = make(limits.stop.global);
    const admittedGeneral: number[] = [];
    const admittedStop: number[] = [];
    const admittedAll: number[] = [];

    for (clock.now = 0; clock.now <= 180_000; clock.now += 100) {
      if (general.take("all")) {
        admittedGeneral.push(clock.now);
        admittedAll.push(clock.now);
      }
      if (stop.take("all")) {
        admittedStop.push(clock.now);
        admittedAll.push(clock.now);
      }
    }
    admittedAll.sort((a, b) => a - b);

    const quota = contractQuotaPerMinute();
    expect(maxInAnyWindow(admittedGeneral, 60_000)).toBeLessThanOrEqual(limits.general.global);
    expect(maxInAnyWindow(admittedStop, 60_000)).toBeLessThanOrEqual(limits.stop.global);
    expect(maxInAnyWindow(admittedStop, 60_000)).toBeLessThanOrEqual(contractQuotas().stop);
    expect(maxInAnyWindow(admittedAll, 60_000)).toBeLessThanOrEqual(quota);
    // The limits are used, not just respected: flat out, the two classes together reach the quota.
    expect(maxInAnyWindow(admittedAll, 60_000)).toBe(limits.general.global + limits.stop.global);
  });

  it("holds for every client counter too: one address driven flat out never exceeds its own limit in any 60 s window", () => {
    const limits = resolveLimits({});
    const clock = { now: 0 };
    const counter = createRateLimiter({ perMinute: limits.stop.perClient, now: () => clock.now, windowMs: LIMIT_WINDOW_MS });
    const admitted: number[] = [];

    for (clock.now = 0; clock.now <= 180_000; clock.now += 100) if (counter.take("one address")) admitted.push(clock.now);

    expect(maxInAnyWindow(admitted, 60_000)).toBeLessThanOrEqual(limits.stop.perClient);
    expect(limits.stop.perClient).toBeLessThanOrEqual(limits.stop.global);
  });
});

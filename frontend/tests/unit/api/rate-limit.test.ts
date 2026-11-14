// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  GENERAL_CEILING_PER_MIN,
  STOP_RESERVE_PER_MIN,
  UPSTREAM_QUOTA_PER_MIN,
  clientKey,
  createRateLimiter,
  resolveLimits,
  trustedProxyHops,
} from "@/app/api/v1/[...path]/rate-limit";

/* The token bucket behind the BFF write limit, driven by an injected clock: no timers, no sleeping. */

function limiter(perMinute: number, maxKeys?: number) {
  const clock = { now: 1_000_000 };
  const instance = createRateLimiter({ perMinute, now: () => clock.now, ...(maxKeys === undefined ? {} : { maxKeys }) });
  return { clock, ...instance };
}

describe("createRateLimiter", () => {
  it("allows a full bucket of writes, then refuses with a Retry-After in whole seconds", () => {
    const { take, peek } = limiter(3);

    expect([take("a"), take("a"), take("a"), take("a")]).toEqual([true, true, true, false]);
    // 3 per minute refills one token every 20 s.
    expect(peek("a")).toEqual({ allowed: false, retryAfterSeconds: 20 });
  });

  it("refills with the clock: one token after 20 s at 3 per minute, never above the bucket size", () => {
    const { clock, take, peek } = limiter(3);
    for (let i = 0; i < 3; i += 1) take("a");

    clock.now += 19_000;
    expect(peek("a").allowed).toBe(false);
    clock.now += 1_000;
    expect(peek("a").allowed).toBe(true);
    expect(take("a")).toBe(true);
    expect(take("a")).toBe(false);

    clock.now += 10 * 60_000;
    expect([take("a"), take("a"), take("a"), take("a")]).toEqual([true, true, true, false]);
  });

  it("keeps a bucket per key", () => {
    const { take } = limiter(1);

    expect([take("a"), take("b"), take("a"), take("b")]).toEqual([true, true, false, false]);
  });

  it("peek changes nothing", () => {
    const { take, peek } = limiter(1);

    for (let i = 0; i < 5; i += 1) expect(peek("a").allowed).toBe(true);
    expect(take("a")).toBe(true);
    expect(peek("a").allowed).toBe(false);
  });

  it("holds at most maxKeys keys: idle buckets go first, then the oldest", () => {
    const { clock, take } = limiter(1, 3);
    take("a");
    take("b");
    take("c");
    // All three are drained and active; a new key must not be refused and memory stays bounded.
    expect(take("d")).toBe(true);
    // The oldest key ("a") was dropped, so it starts full again; "d" is still drained.
    expect(take("a")).toBe(true);
    expect(take("d")).toBe(false);

    clock.now += 60_000;
    expect(take("e")).toBe(true);
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

/** The employer quota the contract states: the smallest single-window limit of any employer operation, per minute. */
function contractQuotaPerMinute(): number {
  const spec = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../openapi/stellar-blaze.openapi.json"), "utf8")) as {
    paths: Record<string, Record<string, { operationId: string; security?: unknown[]; "x-rate-limit"?: { limit: number; window_seconds: number }[] }>>;
  };
  const quotas = Object.values(spec.paths)
    .flatMap((item) => Object.values(item))
    .filter((operation) => (operation.security?.length ?? 0) > 0 && operation["x-rate-limit"]?.length === 1)
    .map((operation) => {
      const [limit] = operation["x-rate-limit"] ?? [];
      return limit === undefined ? Number.POSITIVE_INFINITY : (limit.limit / limit.window_seconds) * 60;
    });
  return Math.min(...quotas);
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
});

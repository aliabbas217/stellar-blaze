// @vitest-environment node
import { clientKey, createRateLimiter, trustedProxyHops } from "@/app/api/v1/[...path]/rate-limit";

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
});

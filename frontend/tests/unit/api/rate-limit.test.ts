// @vitest-environment node
import { clientKey, createRateLimiter } from "@/app/api/v1/[...path]/rate-limit";

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
  it("is the last x-forwarded-for entry, the one the ingress appended", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientKey(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("shares one bucket when the header is missing or empty", () => {
    expect(clientKey(new Headers())).toBe("unknown");
    expect(clientKey(new Headers({ "x-forwarded-for": " " }))).toBe("unknown");
  });
});

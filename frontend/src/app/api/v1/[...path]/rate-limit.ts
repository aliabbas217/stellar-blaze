import type { LimitClass } from "./employer-auth";

/*
 * An in-memory SLIDING-WINDOW counter for the BFF's token-bearing routes (F2 decision D4: visitors to the public demo can
 * act, so what they send upstream is limited): the day-plan read and every write on the allow-list. One counter per
 * client address and one global counter over every client, so a caller who rotates `x-forwarded-for` values still meets
 * the global limit.
 *
 * It is exact: a limit of N admits at most N requests in ANY window of `windowMs`, because it keeps the admission times
 * of the last window and admits only while fewer than N of them are younger than the window. A token bucket does not
 * give that guarantee (it admits its capacity plus a full refill in one window, up to about 2N), which is why this is not
 * one: the BFF's limits exist to stay under an UPSTREAM limit of N per window, and a counter that can pass 2N in a window
 * does not stay under it.
 *
 * Per process: with several replicas each holds its own counters, so the effective limit is the setting times the
 * replica count. That is acceptable for a demo; a shared store is not worth a dependency here.
 *
 * The clock is injected so the tests need no timers.
 */

export interface RateLimiterOptions {
  /** Requests admitted in any window of `windowMs` (the name is for the default window of a minute). */
  perMinute: number;
  now: () => number;
  /** The window length. Default one minute. */
  windowMs?: number;
  /** Most distinct keys held; beyond it keys with nothing in the window, then the oldest, are dropped. */
  maxKeys?: number;
}

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Whether `key` could be admitted now; changes nothing that affects a decision. */
  peek: (key: string) => RateDecision;
  /** Admits `key` now; false when its window is full. */
  take: (key: string) => boolean;
}

const MINUTE_MS = 60_000;
const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter({ perMinute, now, windowMs = MINUTE_MS, maxKeys = DEFAULT_MAX_KEYS }: RateLimiterOptions): RateLimiter {
  /** Admission times of each key, oldest first, only those still inside the window. */
  const admitted = new Map<string, number[]>();

  /** The live admission times of `key` at `at`: those younger than the window (an entry exactly `windowMs` old has left it). */
  function live(key: string, at: number): number[] {
    const times = admitted.get(key) ?? [];
    let expired = 0;
    while (expired < times.length && (times[expired] ?? Number.POSITIVE_INFINITY) <= at - windowMs) expired += 1;
    if (expired > 0) times.splice(0, expired);
    return times;
  }

  function evict(at: number): void {
    if (admitted.size < maxKeys) return;
    for (const key of [...admitted.keys()]) {
      if (live(key, at).length === 0) admitted.delete(key);
    }
    // Still full of active keys: drop the oldest (a Map iterates in insertion order).
    while (admitted.size >= maxKeys) {
      const oldest = admitted.keys().next();
      if (oldest.done === true) break;
      admitted.delete(oldest.value);
    }
  }

  return {
    peek(key) {
      const at = now();
      const times = live(key, at);
      if (times.length < perMinute) return { allowed: true };
      // Full: the next slot opens when the oldest admission leaves the window.
      const opensAt = (times[0] ?? at) + windowMs;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((opensAt - at) / 1000)) };
    },
    take(key) {
      const at = now();
      const times = live(key, at);
      if (times.length >= perMinute) return false;
      if (!admitted.has(key)) evict(at);
      // Delete first so a refreshed key moves to the end of the insertion order.
      admitted.delete(key);
      admitted.set(key, [...times, at]);
      return true;
    },
  };
}

/**
 * How many reverse proxies sit in front of the app and append to `x-forwarded-for` (`TRUSTED_PROXY_HOPS`, default 1: the
 * platform ingress). 0 means none is trusted. An invalid value is the default.
 */
export function trustedProxyHops(raw: string | undefined): number {
  // A blank value (an empty variable in a deployment template) is "not set", not 0: Number("") is 0.
  if (raw === undefined || raw.trim() === "") return 1;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 1;
}

/*
 * The upstream quota and how the BFF spends it.
 *
 * INVARIANT: no rate limit on another operation may block the safety path (stop work, the unwell call actions).
 *
 * The API limits employer operations per access token (`x-rate-limit` in openapi/stellar-blaze.openapi.json: 60 per 60 s),
 * and the contract does not say whether that is one quota per operation or one for all of them. The demo has ONE
 * shared token, so the BFF assumes the worse reading: every token-bearing request of every visitor draws on one quota of
 * `UPSTREAM_QUOTA_PER_MIN` per window. It splits that quota into two sliding-window limits that ADD UP to it: a reserve
 * for Stop work that no other traffic can touch (`STOP_RESERVE_PER_MIN`) and the rest for everything else that carries the
 * token (day-plan reads, sign-off, data requests, demo reset). Each limit is exact (at most N admitted in any window), so
 * general plus stop admit at most the quota in any window and the BFF never sends upstream more than it allows: general
 * traffic is refused here, with the BFF's own 429, once its slice is spent, and a stop is only ever refused by its own
 * reserve. The window the BFF counts is the upstream's plus `UPSTREAM_WINDOW_MARGIN_MS`, because two requests admitted
 * here can reach upstream out of order or a little late, and the margin keeps them apart.
 * tests/unit/api/rate-limit.test.ts reads the quota from the contract, drives every limit flat out on an injected clock
 * and fails if more than the quota is admitted in any 60 s window.
 *
 * demo-reset has a tighter limit of its own upstream (1 per 60 s, 10 per hour). The BFF keeps no counter for it beyond
 * the general one; upstream answers 429 with Retry-After when it is exceeded, the BFF passes that through, and the screen
 * that offers the reset must handle it.
 */
export const UPSTREAM_QUOTA_PER_MIN = 60;
/** The window of every limit: the upstream's 60 s and a margin (see above). */
export const UPSTREAM_WINDOW_MARGIN_MS = 1_000;
export const LIMIT_WINDOW_MS = 60_000 + UPSTREAM_WINDOW_MARGIN_MS;
export const STOP_RESERVE_PER_MIN = 20;
export const GENERAL_CEILING_PER_MIN = UPSTREAM_QUOTA_PER_MIN - STOP_RESERVE_PER_MIN;

export interface ClassLimits {
  /** Requests one client may make in a window (its own counter). Never more than `global`. */
  perClient: number;
  /** Requests all clients together may make in a window: the class's slice of the upstream quota. */
  global: number;
}

export interface WriteLimits {
  /** Everything token-bearing except Stop work: day-plan reads, sign-off, data requests, demo reset. */
  general: ClassLimits;
  /** Stop work (create and clear a stop): the reserve. The per-client limit never exceeds the reserve. */
  stop: ClassLimits;
}

/** A positive integer from an environment value, else the default; never more than `max`. */
function boundedInt(raw: string | undefined, fallback: number, max: number): number {
  const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  const chosen = Number.isInteger(value) && value > 0 ? value : fallback;
  return Math.min(chosen, max);
}

/**
 * The limits for the environment now (requests per window). Defaults: general 20 per client and 40 global, stop 10 per client and 20 global.
 * The environment can only lower them: a global is clamped to its slice (40 and 20, which add up to the upstream quota)
 * and a per-client limit to its class's global, so no setting can make the BFF let through more than upstream allows
 * or let general traffic starve the stop reserve.
 */
export function resolveLimits(env: Readonly<Record<string, string | undefined>>): WriteLimits {
  const generalGlobal = boundedInt(env.DEMO_WRITE_GLOBAL_RATE_PER_MIN, GENERAL_CEILING_PER_MIN, GENERAL_CEILING_PER_MIN);
  const stopGlobal = boundedInt(env.DEMO_STOP_GLOBAL_RATE_PER_MIN, STOP_RESERVE_PER_MIN, STOP_RESERVE_PER_MIN);
  return {
    general: { global: generalGlobal, perClient: boundedInt(env.DEMO_WRITE_RATE_PER_MIN, 20, generalGlobal) },
    stop: { global: stopGlobal, perClient: boundedInt(env.DEMO_STOP_RATE_PER_MIN, 10, stopGlobal) },
  };
}

/**
 * The client of a request, for the per-client counter: the `hops`-th entry of `x-forwarded-for` counted from the RIGHT.
 *
 * Topology assumption: each trusted proxy APPENDS the address it received the request from, so the entry `hops` from the
 * right is the address the outermost trusted proxy saw, and everything left of it is whatever the caller wrote. With
 * one ingress (the default) that is the last entry; behind a CDN and an ingress it is the second from the right. A
 * header with fewer entries than `hops`, a missing header and `hops` of 0 (no trusted proxy: the header is entirely
 * caller-controlled) all share one "unknown" counter, the strictest choice; the global counter is the backstop either way.
 */
export function clientKey(headers: Headers, hops = 1): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded === null || hops < 1) return "unknown";
  const entries = forwarded.split(",").map((entry) => entry.trim());
  const entry = entries[entries.length - hops];
  return entry === undefined || entry === "" ? "unknown" : entry;
}

interface Limiters {
  settings: string;
  perClient: RateLimiter;
  global: RateLimiter;
}

const limiters = new Map<LimitClass, Limiters>();

/** The two counters of a class for the limits in `env` now (read per request, so a restart is not needed). */
export function limitersFor(limitClass: LimitClass, env: Readonly<Record<string, string | undefined>>): Limiters {
  const { perClient, global } = resolveLimits(env)[limitClass];
  const settings = `${String(perClient)}/${String(global)}`;
  const held = limiters.get(limitClass);
  if (held?.settings === settings) return held;
  const fresh: Limiters = {
    settings,
    perClient: createRateLimiter({ perMinute: perClient, now: Date.now, windowMs: LIMIT_WINDOW_MS }),
    global: createRateLimiter({ perMinute: global, now: Date.now, windowMs: LIMIT_WINDOW_MS }),
  };
  limiters.set(limitClass, fresh);
  return fresh;
}

/** Forgets every counter (tests only; a Next route file may not export it, which is why it lives here). */
export function resetLimiters(): void {
  limiters.clear();
}

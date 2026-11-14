import type { LimitClass } from "./employer-auth";

/*
 * An in-memory token bucket for the BFF's allow-listed write routes (F2 decision D4: visitors to the public demo can
 * act, so the writes are limited). One bucket per client IP and one global bucket over every client, so a caller who
 * rotates `x-forwarded-for` values still meets the global limit.
 *
 * Per process: with several replicas each holds its own buckets, so the effective limit is the setting times the
 * replica count. That is acceptable for a demo; a shared store is not worth a dependency here.
 *
 * The clock is injected so the tests need no timers.
 */

export interface RateLimiterOptions {
  /** Writes allowed per minute: the bucket's size and its refill per minute. */
  perMinute: number;
  now: () => number;
  /** Most distinct keys held; beyond it idle (full) buckets, then the oldest, are dropped. */
  maxKeys?: number;
}

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Whether `key` could take a token now; changes nothing. */
  peek: (key: string) => RateDecision;
  /** Takes a token for `key`; false when the bucket is empty. */
  take: (key: string) => boolean;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const MINUTE_MS = 60_000;
const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter({ perMinute, now, maxKeys = DEFAULT_MAX_KEYS }: RateLimiterOptions): RateLimiter {
  const buckets = new Map<string, Bucket>();
  const refillPerMs = perMinute / MINUTE_MS;

  /** The bucket of `key` brought up to date; a key never seen starts full. */
  function current(key: string): Bucket {
    const at = now();
    const found = buckets.get(key);
    if (found === undefined) return { tokens: perMinute, updatedAt: at };
    const elapsed = Math.max(0, at - found.updatedAt);
    return { tokens: Math.min(perMinute, found.tokens + elapsed * refillPerMs), updatedAt: at };
  }

  function evict(): void {
    if (buckets.size < maxKeys) return;
    const at = now();
    for (const [key, bucket] of buckets) {
      if (bucket.tokens + (at - bucket.updatedAt) * refillPerMs >= perMinute) buckets.delete(key);
    }
    // Still full of active keys: drop the oldest (a Map iterates in insertion order).
    while (buckets.size >= maxKeys) {
      const oldest = buckets.keys().next();
      if (oldest.done === true) break;
      buckets.delete(oldest.value);
    }
  }

  return {
    peek(key) {
      const { tokens } = current(key);
      if (tokens >= 1) return { allowed: true };
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000)) };
    },
    take(key) {
      const bucket = current(key);
      if (bucket.tokens < 1) return false;
      if (!buckets.has(key)) evict();
      // Delete first so a refreshed key moves to the end of the insertion order.
      buckets.delete(key);
      buckets.set(key, { tokens: bucket.tokens - 1, updatedAt: bucket.updatedAt });
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
 * `UPSTREAM_QUOTA_PER_MIN`. It splits that quota into two buckets that ADD UP to it: a reserve for Stop work that no
 * other traffic can touch (`STOP_RESERVE_PER_MIN`) and the rest for everything else that carries the token (day-plan
 * reads, sign-off, data requests, demo reset). The BFF refuses the general traffic first, with its own 429, long before
 * upstream would; a stop is only ever refused by its own reserve. tests/unit/api/employer-auth.test.ts reads the quota
 * from the contract and fails if these numbers ever add up to more than it.
 */
export const UPSTREAM_QUOTA_PER_MIN = 60;
export const STOP_RESERVE_PER_MIN = 20;
export const GENERAL_CEILING_PER_MIN = UPSTREAM_QUOTA_PER_MIN - STOP_RESERVE_PER_MIN;

export interface ClassLimits {
  /** Requests per minute one client may make (its bucket). Never more than `global`. */
  perClient: number;
  /** Requests per minute all clients together may make: the class's slice of the upstream quota. */
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
 * The limits for the environment now. Defaults: general 20 per client and 40 global, stop 10 per client and 20 global.
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
 * The client of a request, for the per-client bucket: the `hops`-th entry of `x-forwarded-for` counted from the RIGHT.
 *
 * Topology assumption: each trusted proxy APPENDS the address it received the request from, so the entry `hops` from the
 * right is the address the outermost trusted proxy saw, and everything left of it is whatever the caller wrote. With
 * one ingress (the default) that is the last entry; behind a CDN and an ingress it is the second from the right. A
 * header with fewer entries than `hops`, a missing header and `hops` of 0 (no trusted proxy: the header is entirely
 * caller-controlled) all share one "unknown" bucket, the strictest choice; the global bucket is the backstop either way.
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

/** The two buckets of a class for the limits in `env` now (read per request, so a restart is not needed). */
export function limitersFor(limitClass: LimitClass, env: Readonly<Record<string, string | undefined>>): Limiters {
  const { perClient, global } = resolveLimits(env)[limitClass];
  const settings = `${String(perClient)}/${String(global)}`;
  const held = limiters.get(limitClass);
  if (held?.settings === settings) return held;
  const fresh: Limiters = {
    settings,
    perClient: createRateLimiter({ perMinute: perClient, now: Date.now }),
    global: createRateLimiter({ perMinute: global, now: Date.now }),
  };
  limiters.set(limitClass, fresh);
  return fresh;
}

/** Forgets every bucket (tests only; a Next route file may not export it, which is why it lives here). */
export function resetLimiters(): void {
  limiters.clear();
}

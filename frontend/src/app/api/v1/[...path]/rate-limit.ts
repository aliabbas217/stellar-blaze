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
  const value = Number(raw);
  return raw !== undefined && Number.isInteger(value) && value >= 0 ? value : 1;
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

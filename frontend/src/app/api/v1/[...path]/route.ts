import { problemResponse, UPSTREAM_UNAVAILABLE_TYPE } from "@/api/problem";
import { employerAuth, forwardHeaders, isWorkerCacheableRead, type WriteClass } from "./employer-auth";
import { clientKey, createRateLimiter, trustedProxyHops, type RateLimiter } from "./rate-limit";

/*
 * The BFF proxy: the browser calls only same-origin /api/v1/*, and this handler forwards each call to the API at
 * API_ORIGIN (read per request, so the container's runtime env decides, not the build). Web health is
 * /api/healthz, which is a different route and never proxied.
 *
 * Only an allow-list of headers crosses either way (forwardHeaders in employer-auth.ts). A client's cookie and
 * authorization header never go upstream; the one credential the API sees is the demo employer token, which the BFF
 * attaches itself, only on the allow-listed method and path pairs of the demo fixture (F2 decision D4). Those pairs
 * that write are rate limited per client and globally (two classes, below). Back come content-type, x-request-id and
 * retry-after. Every response is `Cache-Control: no-store` except the two reads the worker's service worker may cache
 * (forecast/today and risk-policy), so no employer or personal response is kept by a browser or a shared cache.
 */

export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = ["content-type", "x-request-id", "retry-after"];

// A hung API must end as a problem the UI can show, not as a request that never answers.
const UPSTREAM_TIMEOUT_MS = 10_000;

const API_PREFIX = "/api/v1/";

/*
 * The write limits. The API limits employer operations to 60 per 60 s per token (its `x-rate-limit`), and the demo has
 * one shared token, so 60 a minute is one global ceiling for every visitor; the global defaults below match it and are
 * what a visitor meets first, as a 429 from here with a Retry-After, instead of from the API. The per-client bucket
 * keeps one visitor from using all of it.
 *
 * Stop work has its OWN pair of buckets, so sign-off, data-request and reset traffic can never drain it: a stop that is
 * refused with a 429 is a safety failure (the screen must say "Not sent. Tell the crew now."), so its per-client
 * default is larger. The global ceiling of 60 is the API's, a higher number here could never be used.
 */
interface LimitSettings {
  perClientEnv: string;
  perClientDefault: number;
  globalEnv: string;
  globalDefault: number;
}

const LIMITS: Record<WriteClass, LimitSettings> = {
  write: { perClientEnv: "DEMO_WRITE_RATE_PER_MIN", perClientDefault: 20, globalEnv: "DEMO_WRITE_GLOBAL_RATE_PER_MIN", globalDefault: 60 },
  stop: { perClientEnv: "DEMO_STOP_RATE_PER_MIN", perClientDefault: 30, globalEnv: "DEMO_STOP_GLOBAL_RATE_PER_MIN", globalDefault: 60 },
};

const GLOBAL_KEY = "demo-token";

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return raw !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

interface Limiters {
  settings: string;
  perClient: RateLimiter;
  global: RateLimiter;
}

const limiters = new Map<WriteClass, Limiters>();

/** The two buckets of a class for the limits in the environment now (read per request, so a restart is not needed). */
function limitersFor(writeClass: WriteClass): Limiters {
  const config = LIMITS[writeClass];
  const perClient = positiveInt(process.env[config.perClientEnv], config.perClientDefault);
  const global = positiveInt(process.env[config.globalEnv], config.globalDefault);
  const settings = `${String(perClient)}/${String(global)}`;
  const held = limiters.get(writeClass);
  if (held?.settings === settings) return held;
  const fresh: Limiters = {
    settings,
    perClient: createRateLimiter({ perMinute: perClient, now: Date.now }),
    global: createRateLimiter({ perMinute: global, now: Date.now }),
  };
  limiters.set(writeClass, fresh);
  return fresh;
}

/** A 429 problem with Retry-After when either bucket is empty; otherwise takes one token from each and returns null. */
function rateLimited(request: Request, writeClass: WriteClass): Response | null {
  const { perClient, global } = limitersFor(writeClass);
  const key = clientKey(request.headers, trustedProxyHops(process.env.TRUSTED_PROXY_HOPS));
  const mine = perClient.peek(key);
  const all = global.peek(GLOBAL_KEY);
  if (mine.allowed && all.allowed) {
    perClient.take(key);
    global.take(GLOBAL_KEY);
    return null;
  }
  const retryAfter = Math.max(mine.allowed ? 0 : mine.retryAfterSeconds, all.allowed ? 0 : all.retryAfterSeconds);
  const response = problemResponse({
    type: "urn:stellar-blaze:problem:rate-limited",
    title: "Rate limited",
    status: 429,
    detail: "The demo allows a limited number of changes per minute. Wait and try again.",
    request_id: requestIdOf(request),
  });
  response.headers.set("retry-after", String(retryAfter));
  return response;
}

function requestIdOf(request: Request): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

function unavailable(request: Request, reason: string, cause?: unknown): Response {
  const requestId = requestIdOf(request);
  // The browser gets a generic problem; the cause stays in the server log, tied to the same request id.
  console.error("bff: upstream unavailable", { request_id: requestId, reason, cause });
  return problemResponse({
    type: UPSTREAM_UNAVAILABLE_TYPE,
    title: "Upstream unavailable",
    status: 502,
    request_id: requestId,
  });
}

async function answer(request: Request): Promise<Response> {
  const origin = process.env.API_ORIGIN;
  if (origin === undefined || origin === "") return unavailable(request, "API_ORIGIN is not set");

  const incoming = new URL(request.url);
  // Parsing the URL resolves dot segments ("/api/v1/%2e%2e/admin" becomes "/admin"). Whatever the router matched,
  // only /api/v1/* may be forwarded: the proxy must not become a way to reach other paths of the API.
  if (!incoming.pathname.startsWith(API_PREFIX)) {
    return problemResponse({ type: "about:blank", title: "Not Found", status: 404, request_id: requestIdOf(request) });
  }
  const decision = employerAuth(request.method, incoming.pathname);
  if (decision.writeClass !== null) {
    const limited = rateLimited(request, decision.writeClass);
    if (limited !== null) return limited;
  }
  // The token is read now, per request, from the server's environment. Never a NEXT_PUBLIC variable.
  const headers = forwardHeaders(request.headers, decision.inject ? process.env.DEMO_EMPLOYER_TOKEN : undefined);

  let upstream: Response;
  try {
    const target = new URL(`${incoming.pathname}${incoming.search}`, origin);
    // The request bodies here are small JSON documents (a push subscription), so they are buffered rather than streamed.
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    upstream = await fetch(target, {
      method: request.method,
      headers,
      ...(body === undefined || body.byteLength === 0 ? {} : { body }),
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    return unavailable(request, "request to the API failed", error);
  }

  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  // The body is streamed back as it arrives; a 204 has none.
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

async function forward(request: Request): Promise<Response> {
  const response = await answer(request);
  // Only a successful answer to one of the two worker-cacheable reads may be stored; everything else, errors included, never.
  const cacheable = response.ok && isWorkerCacheableRead(request.method, new URL(request.url).pathname);
  if (!cacheable) response.headers.set("cache-control", "no-store");
  return response;
}

export const GET = forward;
export const POST = forward;
export const DELETE = forward;

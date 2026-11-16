import { problemResponse, UPSTREAM_UNAVAILABLE_TYPE } from "@/api/problem";
import { employerAuth, forwardHeaders, isWorkerCacheableRead, type LimitClass } from "./employer-auth";
import { isSafetyRoute, pathSegmentsOf, upstreamTimeouts, type UpstreamTimeouts } from "@/lib/upstream-timeouts";
import { clientKey, limitersFor, trustedProxyHops } from "./rate-limit";

/*
 * INVARIANT: no rate limit on another operation may block the safety path (stop work, unwell call actions). The
 * employer operations may share one upstream quota per token and the demo has one shared token, so the two limits below
 * add up to that quota, exactly, in any window (rate-limit.ts), and Stop work has a reserve nothing else can drain.
 *
 * The BFF proxy: the browser calls only same-origin /api/v1/*, and this handler forwards each call to the API at
 * API_ORIGIN (read per request, so the container's runtime env decides, not the build). Web health is
 * /api/healthz, which is a different route and never proxied.
 *
 * Only an allow-list of headers crosses either way (forwardHeaders in employer-auth.ts). A client's cookie and
 * authorization header never go upstream; the one credential the API sees is the demo employer token, which the BFF
 * attaches itself, only on the allow-listed method and path pairs of the demo fixture (F2 decision D4). Those pairs
 * (every one of them carries the token) are rate limited per client and globally, in two classes (below). Back come content-type, x-request-id and
 * retry-after. Every response is `Cache-Control: no-store` except the two reads the worker's service worker may cache
 * (forecast/today and risk-policy), so no employer or personal response is kept by a browser or a shared cache.
 */

export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = ["content-type", "x-request-id", "retry-after"];

/*
 * A hung API must end as a problem the UI can show, not as a request that never answers. Two limits (src/lib/upstream-timeouts.ts):
 * Stop work and its undo or resume are held to UPSTREAM_TIMEOUT_MS (default 10 s: a Stop never hangs), everything else to
 * UPSTREAM_READ_TIMEOUT_MS (default 10 s; the deployment raises it so a cold start of the scaled-to-zero API is waited out, not
 * shown as an error). A timed-out request of either kind is the same 502 upstream-unavailable problem as an unreachable API.
 */

const API_PREFIX = "/api/v1/";

/*
 * The limits (rate-limit.ts has the arithmetic). Two classes that add up to the upstream quota of one token:
 *  - "stop": Stop work (create and clear a stop), a reserve of 20 a minute that nothing else draws on. A stop is refused
 *    only by this limit. A 429 on a stop is a safety failure: the screen must say "Not sent. Tell the crew now."
 *  - "general": every other token-bearing request, the day-plan GET included (it spends the same upstream quota): sign-off,
 *    data requests, demo reset. 40 a minute for everyone together; the BFF refuses these first.
 * Each class has a global limit and a per-client limit (the per-client limit never exceeds its global), so one
 * visitor cannot take a whole slice. The environment can only lower the defaults.
 */
const GLOBAL_KEY = "demo-token";

/** A 429 problem with Retry-After when either limit is spent; otherwise records the request against both and returns null. */
function rateLimited(request: Request, limitClass: LimitClass): Response | null {
  const { perClient, global } = limitersFor(limitClass, process.env);
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

interface LoggedCause {
  name: string;
  message: string;
  cause?: LoggedCause;
}

/**
 * An error as the log shows it: its name and message, and its own cause's the same way, nothing else. The error object itself is
 * never logged (a timeout's DOMException prints about 30 lines of stack and constants; any error might carry a request or its
 * headers). `fetch failed` alone says nothing, so the connection error under it (ECONNREFUSED, a DNS failure) is kept one level down.
 * A thrown value that is not an Error is not logged at all.
 */
function loggedCause(error: unknown, depth = 0): LoggedCause | undefined {
  if (!(error instanceof Error)) return undefined;
  const inner = depth < 2 ? loggedCause(error.cause, depth + 1) : undefined;
  return { name: error.name, message: error.message, ...(inner === undefined ? {} : { cause: inner }) };
}

function unavailable(request: Request, reason: string, cause?: unknown): Response {
  const requestId = requestIdOf(request);
  // The browser gets a generic problem; the cause (name and message only) stays in the server log, tied to the same request id.
  const logged = loggedCause(cause);
  console.error("bff: upstream unavailable", { request_id: requestId, reason, ...(logged === undefined ? {} : { cause: logged }) });
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
  // Parsed now, before anything is spent on the request: a bad value is an error with its name in the log, never a default
  // (instrumentation.ts throws at server start, after which the server answers 500 everywhere; this is the guard where that did not run).
  let limits: UpstreamTimeouts;
  try {
    limits = upstreamTimeouts();
  } catch (error) {
    // The message is the reason; there is nothing more in the error worth logging.
    return unavailable(request, error instanceof Error ? error.message : "the upstream time limits are invalid");
  }
  const isSafety = isSafetyRoute(request.method, pathSegmentsOf(incoming.pathname));
  const timeoutMs = isSafety ? limits.safetyMs : limits.readMs;
  // A read the client has given up on (tab closed, connection dropped) is aborted upstream too, so a hung read does not hold the
  // API for the whole limit. NEVER a write or a safety route: a Stop or a sign-off in flight must reach the API even if the phone
  // loses its connection a moment after pressing it, and only its own time limit may cut it.
  const abortsWithClient = !isSafety && (request.method === "GET" || request.method === "HEAD");
  const decision = employerAuth(request.method, incoming.pathname);
  if (decision.limitClass !== null) {
    const limited = rateLimited(request, decision.limitClass);
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
      signal: abortsWithClient ? AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
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

import { problemResponse, UPSTREAM_UNAVAILABLE_TYPE } from "@/api/problem";
import { employerAuth, forwardHeaders } from "./employer-auth";
import { clientKey, createRateLimiter, type RateLimiter } from "./rate-limit";

/*
 * The BFF proxy: the browser calls only same-origin /api/v1/*, and this handler forwards each call to the API at
 * API_ORIGIN (read per request, so the container's runtime env decides, not the build). Web health is
 * /api/healthz, which is a different route and never proxied.
 *
 * Only an allow-list of headers crosses either way (forwardHeaders in employer-auth.ts). A client's cookie and
 * authorization header never go upstream; the one credential the API sees is the demo employer token, which the BFF
 * attaches itself, only on the allow-listed method and path pairs of the demo fixture (F2 decision D4). Those pairs
 * that write are rate limited per client and globally. Nothing but content-type and x-request-id comes back.
 */

export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = ["content-type", "x-request-id"];

// A hung API must end as a problem the UI can show, not as a request that never answers.
const UPSTREAM_TIMEOUT_MS = 10_000;

const API_PREFIX = "/api/v1/";

const DEFAULT_WRITES_PER_MIN = 20;
const DEFAULT_GLOBAL_WRITES_PER_MIN = 120;
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

let limiters: Limiters | undefined;

/** The two write buckets for the limits in the environment now (read per request, so a restart is not needed). */
function writeLimiters(): Limiters {
  const perClient = positiveInt(process.env.DEMO_WRITE_RATE_PER_MIN, DEFAULT_WRITES_PER_MIN);
  const global = positiveInt(process.env.DEMO_WRITE_GLOBAL_RATE_PER_MIN, DEFAULT_GLOBAL_WRITES_PER_MIN);
  const settings = `${String(perClient)}/${String(global)}`;
  if (limiters?.settings !== settings) {
    limiters = {
      settings,
      perClient: createRateLimiter({ perMinute: perClient, now: Date.now }),
      global: createRateLimiter({ perMinute: global, now: Date.now }),
    };
  }
  return limiters;
}

/** A 429 problem with Retry-After when either bucket is empty; otherwise takes one token from each and returns null. */
function rateLimited(request: Request): Response | null {
  const { perClient, global } = writeLimiters();
  const key = clientKey(request.headers);
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
    title: "Too Many Requests",
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

async function forward(request: Request): Promise<Response> {
  const origin = process.env.API_ORIGIN;
  if (origin === undefined || origin === "") return unavailable(request, "API_ORIGIN is not set");

  const incoming = new URL(request.url);
  // Parsing the URL resolves dot segments ("/api/v1/%2e%2e/admin" becomes "/admin"). Whatever the router matched,
  // only /api/v1/* may be forwarded: the proxy must not become a way to reach other paths of the API.
  if (!incoming.pathname.startsWith(API_PREFIX)) {
    return problemResponse({ type: "about:blank", title: "Not Found", status: 404, request_id: requestIdOf(request) });
  }
  const decision = employerAuth(request.method, incoming.pathname);
  if (decision.write) {
    const limited = rateLimited(request);
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

export const GET = forward;
export const POST = forward;
export const DELETE = forward;

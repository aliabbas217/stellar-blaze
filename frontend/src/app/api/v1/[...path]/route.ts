import { MOCK_SCENARIO_HEADER, mockScenariosEnabled } from "@/api/mock-scenario";
import { problemResponse, UPSTREAM_UNAVAILABLE_TYPE } from "@/api/problem";

/*
 * The BFF proxy: the browser calls only same-origin /api/v1/*, and this handler forwards each call to the API at
 * API_ORIGIN (read per request, so the container's runtime env decides, not the build). Web health is
 * /api/healthz, which is a different route and never proxied.
 *
 * Only an allow-list of headers crosses either way. In particular no cookie or authorization header goes
 * upstream (the API takes none today), and nothing but content-type and x-request-id comes back.
 */

export const dynamic = "force-dynamic";

const REQUEST_HEADERS = ["content-type", "accept", "x-request-id"];
const RESPONSE_HEADERS = ["content-type", "x-request-id"];

// A hung API must end as a problem the UI can show, not as a request that never answers.
const UPSTREAM_TIMEOUT_MS = 10_000;

const API_PREFIX = "/api/v1/";

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
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const scenario = request.headers.get(MOCK_SCENARIO_HEADER);
  if (scenario !== null && mockScenariosEnabled()) headers.set(MOCK_SCENARIO_HEADER, scenario);

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

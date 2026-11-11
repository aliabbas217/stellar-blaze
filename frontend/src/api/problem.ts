/*
 * Every non-2xx response of the API is application/problem+json (RFC 9457 shape plus request_id; see
 * openapi/stellar-blaze.mock.openapi.json, schema `Problem`). This module is the one place that reads that shape
 * and the one place that builds it, so the BFF proxy, the mock handlers and the UI agree on it.
 *
 * It is also loaded by scripts/mock-api.ts, which Node runs with type stripping: keep it free of enums, namespaces
 * and constructor parameter properties, and import only packages (no "@/" alias) from here.
 */

/**
 * The members of a problem+json body that this client reads. `request_id` is optional here although the API always
 * sets it: a response that did not come from our API (a proxy's HTML 502, a network layer) has none, and
 * `toProblem` still has to describe it. Members this client does not know yet are ignored, so the API can add some
 * without breaking it.
 *
 * Written by hand, with a hand-written reader below, and not as a zod schema, so that the browser bundle (the worker
 * routes have a 170 KB budget) does not carry a validation library for six fields: zod costs about 15 KB gzip even
 * as zod/mini. `ProblemSchema` in problem-schema.ts states the same contract for tests, and
 * tests/unit/api/problem-parity.test.ts pins that the two agree, in types and in behaviour.
 */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string | undefined;
  instance?: string | undefined;
  request_id?: string | undefined;
}

/** The BFF proxy could not get an answer from the API (unconfigured, unreachable, timed out). */
export const UPSTREAM_UNAVAILABLE_TYPE = "urn:stellar-blaze:problem:upstream-unavailable";

/** The browser could not reach the BFF at all (offline). Never sent over the wire, so it has no request_id. */
export const NETWORK_ERROR_TYPE = "urn:stellar-blaze:problem:network-error";

/**
 * The members of a problem+json body that this client reads, or undefined when `body` is not one: the same rules as
 * ProblemSchema (problem-schema.ts; tests/unit/api/problem-parity.test.ts pins that). Unknown members are dropped, as
 * the schema drops them.
 */
function readProblemBody(body: unknown): Problem | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const members = body as Record<string, unknown>;
  const { type, title, status } = members;
  if (typeof type !== "string" || typeof title !== "string" || typeof status !== "number" || !Number.isSafeInteger(status)) {
    return undefined;
  }
  const problem: Problem = { type, title, status };
  for (const key of ["detail", "instance", "request_id"] as const) {
    const value = members[key];
    if (value === undefined) continue;
    if (typeof value !== "string") return undefined;
    problem[key] = value;
  }
  return problem;
}

/** A failed call, as a throwable, for code that prefers exceptions (a TanStack Query `queryFn`). */
export class ApiProblem extends Error {
  readonly problem: Problem;

  constructor(problem: Problem, options?: ErrorOptions) {
    super(problem.detail === undefined ? problem.title : `${problem.title}: ${problem.detail}`, options);
    this.name = "ApiProblem";
    this.problem = problem;
  }
}

/**
 * The Problem for a failed response. `body` is whatever the HTTP client parsed (openapi-fetch gives parsed JSON,
 * or the raw text when it is not JSON). When it is not a problem body, the response itself is described: its
 * status, its reason phrase (empty over HTTP/2, so the status stands in for it) and its x-request-id header.
 */
export function toProblem(res: Response, body: unknown): Problem {
  const problem = readProblemBody(body);
  if (problem !== undefined) return problem;
  return {
    type: "about:blank",
    title: res.statusText === "" ? `HTTP ${String(res.status)}` : res.statusText,
    status: res.status,
    request_id: res.headers.get("x-request-id") ?? undefined,
  };
}

/** A transport failure (the request never produced a response). Status 0, as `Response.error()` has. */
export function networkProblem(): Problem {
  return { type: NETWORK_ERROR_TYPE, title: "Network error", status: 0 };
}

/** An application/problem+json response carrying `problem`, with its request id mirrored in x-request-id. */
export function problemResponse(problem: Problem): Response {
  const headers = new Headers({ "content-type": "application/problem+json" });
  if (problem.request_id !== undefined) headers.set("x-request-id", problem.request_id);
  return new Response(JSON.stringify(problem), { status: problem.status, headers });
}

import { z } from "zod";

/*
 * Every non-2xx response of the API is application/problem+json (RFC 9457 shape plus request_id; see
 * openapi/stellar-blaze.mock.openapi.json, schema `Problem`). This module is the one place that reads that shape
 * and the one place that builds it, so the BFF proxy, the mock handlers and the UI agree on it.
 *
 * It is also loaded by scripts/mock-api.ts, which Node runs with type stripping: keep it free of enums, namespaces
 * and constructor parameter properties, and import only packages (no "@/" alias) from here.
 */

/**
 * `request_id` is optional here although the API always sets it: a response that did not come from our API
 * (a proxy's HTML 502, a network layer) has none, and `toProblem` still has to describe it. Members this client
 * does not know yet are ignored, so the API can add some without breaking it.
 */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  request_id: z.string().optional(),
});

export type Problem = z.infer<typeof ProblemSchema>;

/** The BFF proxy could not get an answer from the API (unconfigured, unreachable, timed out). */
export const UPSTREAM_UNAVAILABLE_TYPE = "urn:stellar-blaze:problem:upstream-unavailable";

/** The browser could not reach the BFF at all (offline). Never sent over the wire, so it has no request_id. */
export const NETWORK_ERROR_TYPE = "urn:stellar-blaze:problem:network-error";

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
  const parsed = ProblemSchema.safeParse(body);
  if (parsed.success) return parsed.data;
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

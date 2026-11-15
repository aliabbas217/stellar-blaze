/*
 * Every non-2xx response of the API is application/problem+json (RFC 9457 shape plus request_id; see
 * openapi/stellar-blaze.openapi.json, schema `Problem`). This module is the one place that reads that shape
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
  /**
   * The shift rules a crew's published shift breaks by itself (the 422 `shift-not-legal` of the day plan and the sign-off,
   * ShiftNotLegalProblem). Present only when the body carries a well-formed list; the plan screen shows each as a row.
   */
  violations?: ShiftViolation[] | undefined;
  /** The ack item ids a sign-off left out (the 409 `review-required`, ReviewRequiredProblem). Present only when well formed. */
  missing_items?: string[] | undefined;
}

/** One rule a shift breaks (contract schema `ShiftViolation`). `clause` may be empty: the screen shows it only when it is not. */
export interface ShiftViolation {
  rule_id: string;
  clause: string;
  source_id: string;
}

/** A list of strings, or undefined (a malformed list is dropped, the problem itself is still read). */
function readStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return (value as unknown[]).every((item) => typeof item === "string") ? (value as string[]).slice() : undefined;
}

/** A well-formed `violations` list, or undefined: a malformed one is dropped, the problem itself is still read. */
function readViolations(value: unknown): ShiftViolation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: ShiftViolation[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null) return undefined;
    const { rule_id, clause, source_id } = item as Record<string, unknown>;
    if (typeof rule_id !== "string" || typeof clause !== "string" || typeof source_id !== "string") return undefined;
    out.push({ rule_id, clause, source_id });
  }
  return out;
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
  const violations = readViolations(members["violations"]);
  if (violations !== undefined) problem.violations = violations;
  const missing = readStrings(members["missing_items"]);
  if (missing !== undefined) problem.missing_items = missing;
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

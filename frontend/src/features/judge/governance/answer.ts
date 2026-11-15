import type { Problem } from "@/api/problem";
import type { RefusalAnswer } from "./recorded-view";

/*
 * What the page makes of the API's answer to the employer's request. The only answer that means "refused" is the 403 whose
 * problem type is `individual-data-refused`; every other outcome is told apart so the page never says "refused" about a
 * request that was not (a 401 that never reached the rule, a 429 the BFF turned away, an unreachable API).
 */

export const REFUSED_TYPE = "urn:stellar-blaze:problem:individual-data-refused";

/**
 * The class of data this page asks for. The page chooses it, so it is the one place the word "health" belongs: the request
 * card shows it and the request body carries it (one constant, so what is shown is what is sent). A log row carries no class,
 * so every sentence derived from a row says "individual data".
 */
export const REQUEST_DATA_CLASS = "health" as const;

/** A made-up example reference: the API validates it and discards it (ADR 0054), so nothing about a person is ever sent. */
export const SYNTHETIC_WORKER_REF = "synthetic-example-worker";

export type Outcome =
  | { readonly kind: "refused"; readonly answer: RefusalAnswer }
  /** 401: the deployment has no demo employer token for the BFF to attach. */
  | { readonly kind: "unauthorized" }
  /** 429: the BFF or the API turned the call away. Never retried by the page. */
  | { readonly kind: "limited" }
  /** Any other failure, the network included: nothing was sent, so nothing was recorded. */
  | { readonly kind: "failed"; readonly requestId: string | null }
  /** A 2xx: the API did NOT refuse, which the contract says cannot happen. Never reported as a result. */
  | { readonly kind: "unexpected" };

/** The outcome of a failed call (an `ApiProblem`'s problem) at `answeredAt`. */
export function outcomeOf(problem: Problem, answeredAt: string, contentType = "application/problem+json"): Outcome {
  if (problem.status === 403 && problem.type === REFUSED_TYPE) {
    return {
      kind: "refused",
      answer: { status: 403, contentType, answeredAt, type: problem.type, title: problem.title, requestId: problem.request_id ?? null },
    };
  }
  if (problem.status === 401) return { kind: "unauthorized" };
  if (problem.status === 429) return { kind: "limited" };
  return { kind: "failed", requestId: problem.request_id ?? null };
}

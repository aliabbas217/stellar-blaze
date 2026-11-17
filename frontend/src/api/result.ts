import { networkProblem, toProblem, type Problem } from "@/api/problem";

/** The outcome of an API call. HTTP failures are values here, not exceptions: the request id survives. */
export type Result<T> = { ok: true; data: T } | { ok: false; problem: Problem };

function nameOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "name" in error && typeof error.name === "string" ? error.name : undefined;
}

/**
 * Whether `error` is a request that was cancelled (`AbortError`). Judged by the error's NAME and not by `instanceof DOMException`:
 * that class belongs to a realm (a page, a worker, or a test environment such as jsdom), and `fetch` can throw the `DOMException`
 * of another realm (in jsdom it does), for which `instanceof` is false although the error is an abort.
 */
export function isAbortError(error: unknown): boolean {
  return nameOf(error) === "AbortError";
}

/** Whether `error` is an abort or a timeout (`AbortSignal.timeout` rejects with a `TimeoutError`); by name, for the reason above. */
export function isAbortOrTimeout(error: unknown): boolean {
  const name = nameOf(error);
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * Settles an openapi-fetch call into a Result.
 *
 *  - 2xx: `ok`. A 204 has no body, so `data` is undefined there and T is the operation's empty response type.
 *  - any other status: `problem`, read from the body when it is problem+json and from the response otherwise.
 *  - a transport failure (the promise rejects, e.g. offline): a network problem with no request id.
 *  - an abort is rethrown. A cancelled query is not a failure, and TanStack Query relies on seeing the abort.
 */
export async function call<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<Result<T>> {
  let settled: { data?: T; error?: unknown; response: Response };
  try {
    settled = await p;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { ok: false, problem: networkProblem() };
  }

  const { data, error, response } = settled;
  // For a 204 openapi-fetch resolves { data: undefined }, which T admits only as its empty response type.
  if (response.ok) return { ok: true, data: data as T };
  return { ok: false, problem: toProblem(response, error) };
}

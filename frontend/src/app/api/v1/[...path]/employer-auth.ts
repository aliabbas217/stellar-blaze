import { MOCK_SCENARIO_HEADER, mockScenariosEnabled } from "@/api/mock-scenario";

/*
 * The BFF's demo employer token (ADR 0051 decision 5; F2 decision D4). The public demo has no employer sign-in: the
 * BFF holds one token server-side (DEMO_EMPLOYER_TOKEN, read per request, never NEXT_PUBLIC) and attaches it only to
 * an allow-list of method and path pairs that act on the synthetic demo fixture. Everything else, and every client
 * Authorization header, goes upstream without credentials, so a visitor cannot use the proxy to reach another
 * employer's crew or a non-demo site.
 *
 * Pure functions, so the allow-list is unit-tested without a server (tests/unit/api/employer-auth.test.ts).
 */

/** The crews of the demo fixture (ADR 0057): crew-a to crew-d. */
const CREW = "crew-[a-d]";
/** Synthetic sites only: the demo fixture's ids all start with "site-demo-". */
const SITE = "site-demo-[a-z0-9-]+";
const STOP = "[A-Za-z0-9_-]+";

/** The rate-limit class of an allow-listed write: Stop work has its own buckets (see route.ts). */
export type WriteClass = "write" | "stop";

interface Rule {
  method: "GET" | "POST" | "DELETE";
  path: RegExp;
  /** Set for a write, absent for a read. */
  writeClass?: WriteClass;
}

const ALLOW_LIST: readonly Rule[] = [
  { method: "GET", path: new RegExp(`^/api/v1/crews/${CREW}/day-plan$`) },
  { method: "POST", path: new RegExp(`^/api/v1/crews/${CREW}/day-plan/sign-off$`), writeClass: "write" },
  { method: "POST", path: new RegExp(`^/api/v1/crews/${CREW}/stops$`), writeClass: "stop" },
  { method: "DELETE", path: new RegExp(`^/api/v1/crews/${CREW}/stops/${STOP}$`), writeClass: "stop" },
  { method: "POST", path: new RegExp(`^/api/v1/sites/${SITE}/data-requests$`), writeClass: "write" },
  // reset_demo_site: synthetic site ids only (the API also answers 409 not-a-demo-site for any other).
  { method: "POST", path: new RegExp(`^/api/v1/sites/${SITE}/demo-reset$`), writeClass: "write" },
];

export interface EmployerAuthDecision {
  /** Attach the demo employer token to the upstream request. */
  inject: boolean;
  /** The rate-limit class when the pair is an allow-listed write (POST or DELETE); null for a read or a pair off the list. */
  writeClass: WriteClass | null;
}

/** Whether the BFF attaches the demo token to `method` `path` (the URL's pathname, without the query string). */
export function employerAuth(method: string, path: string): EmployerAuthDecision {
  const verb = method.toUpperCase();
  const rule = ALLOW_LIST.find((candidate) => candidate.method === verb && candidate.path.test(path));
  return { inject: rule !== undefined, writeClass: rule?.writeClass ?? null };
}

const WORKER_CACHEABLE_READS: readonly RegExp[] = [/^\/api\/v1\/risk-policy$/, /^\/api\/v1\/sites\/[^/]+\/forecast\/today$/];

/**
 * The two non-personal reads the worker's service worker may cache (F2 decision D2: forecast/today and risk-policy).
 * Every other response of the proxy is `Cache-Control: no-store`.
 */
export function isWorkerCacheableRead(method: string, path: string): boolean {
  return method.toUpperCase() === "GET" && WORKER_CACHEABLE_READS.some((pattern) => pattern.test(path));
}

/** The request headers that cross to the API; nothing else does. */
const REQUEST_HEADERS = ["content-type", "accept", "x-request-id"];

/**
 * The headers of the upstream request: the allow-list above, the mock scenario header where it is enabled, and, when
 * `token` is set, `Authorization: Bearer <token>`. A client's own Authorization header is never copied, so a visitor's
 * credentials neither reach the API nor stand in for the demo token.
 */
export function forwardHeaders(incoming: Headers, token: string | undefined): Headers {
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value !== null) headers.set(name, value);
  }
  const scenario = incoming.get(MOCK_SCENARIO_HEADER);
  if (scenario !== null && mockScenariosEnabled()) headers.set(MOCK_SCENARIO_HEADER, scenario);
  if (token !== undefined && token !== "") headers.set("authorization", `Bearer ${token}`);
  return headers;
}

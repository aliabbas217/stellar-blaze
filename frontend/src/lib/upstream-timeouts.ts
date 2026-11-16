/*
 * How long the BFF waits for the API (src/app/api/v1/[...path]/route.ts). SERVER ONLY: the route and src/instrumentation.ts import
 * it and nothing that ships to a browser may (tests/unit/lib/upstream-timeouts.test.ts pins the importers). It is not marked with
 * `import "server-only"` because instrumentation.ts must be able to load it outside a React Server Component bundle.
 *
 * Two limits, because the two kinds of request want opposite things:
 *  - UPSTREAM_TIMEOUT_MS: the SAFETY routes (Stop work and its undo or resume). A Stop never hangs: default 10 s.
 *  - UPSTREAM_READ_TIMEOUT_MS: everything else. When the API scales to zero a cold start took about 29 s, and a read that is cut
 *    before that shows the first visitor after a quiet period an error. Default 10 s; the deployment raises it (about 45 s).
 *
 * Both are read at request time like API_ORIGIN (the container's environment decides, not the build). A value that is set but
 * is not a plain whole number of milliseconds within its own range is an error, never a silent fall back to the default: a limit
 * nobody chose is how a Stop ends up waiting two minutes. The ranges differ: the safety limit is capped at 15000 (the phone's own
 * longest safety wait, CLEAR_STOP_TIMEOUT_MS), reads at 120000.
 *
 * What an error does: instrumentation.ts validates at server start and throws, and the route validates again on first use. Next 16
 * does not exit on a throw from `register()`: the standalone server stays up, logs the message below (it names the variable, the
 * value and the range), and answers 500 to every request, `/api/healthz` included. So a release probe on `/api/healthz` never passes
 * for a revision with a bad value (the previous revision keeps serving), and the route's own check answers a logged 502 where
 * `register()` did not run. There is no `process.exit`.
 */

export const SAFETY_TIMEOUT_VAR = "UPSTREAM_TIMEOUT_MS";
export const READ_TIMEOUT_VAR = "UPSTREAM_READ_TIMEOUT_MS";

/** The default of both limits, and what a Stop is held to unless the deployment says otherwise. */
export const DEFAULT_TIMEOUT_MS = 10_000;
/** The most the SAFETY limit may be (inclusive): equal to the phone's undo limit, CLEAR_STOP_TIMEOUT_MS, so no setting makes a Stop wait longer than the app already allows. */
export const MAX_SAFETY_TIMEOUT_MS = 15_000;
/** The most the READ limit may be (inclusive). Two minutes is longer than any cold start measured, and short of a platform's own ingress limit. */
export const MAX_READ_TIMEOUT_MS = 120_000;

export interface UpstreamTimeouts {
  /** For Stop work and its undo or resume. */
  readonly safetyMs: number;
  /** For every other request. */
  readonly readMs: number;
}

type Env = Readonly<Record<string, string | undefined>>;

/** A plain base-10 whole number with no sign, no leading zero, no spaces and no exponent, decimal point or prefix: ASCII digits only. */
const PLAIN_POSITIVE_INTEGER = /^[1-9][0-9]*$/;

/** The reason `raw` is not acceptable for `name`, or null when it is. `raw` is neither undefined nor empty here. */
function problemWith(name: string, raw: string, max: number): string | null {
  // A long digit string is rejected before Number() so that it cannot round to a number inside the range.
  if (PLAIN_POSITIVE_INTEGER.test(raw) && raw.length <= String(max).length && Number(raw) <= max) return null;
  return `${name}=${JSON.stringify(raw)} is not allowed: use a plain whole number of milliseconds from 1 to ${String(max)} (digits only: no unit, spaces, sign, decimal point, exponent or leading zero), or leave it unset for ${String(DEFAULT_TIMEOUT_MS)}.`;
}

/**
 * The two limits for `env`. Unset or empty is the default (an empty value in a deployment template is "not set", as for
 * APP_VERSION). Throws one Error that names every variable that is wrong, with its value and the allowed range.
 */
export function resolveUpstreamTimeouts(env: Env): UpstreamTimeouts {
  const problems: string[] = [];
  const read = (name: string, max: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === "") return DEFAULT_TIMEOUT_MS;
    const problem = problemWith(name, raw, max);
    if (problem !== null) {
      problems.push(problem);
      return DEFAULT_TIMEOUT_MS;
    }
    return Number(raw);
  };
  const safetyMs = read(SAFETY_TIMEOUT_VAR, MAX_SAFETY_TIMEOUT_MS);
  const readMs = read(READ_TIMEOUT_VAR, MAX_READ_TIMEOUT_MS);
  // The placeholder default above is never returned: any problem throws.
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return { safetyMs, readMs };
}

/** The limits for this process's environment, parsed now (per request, like API_ORIGIN). */
export function upstreamTimeouts(): UpstreamTimeouts {
  return resolveUpstreamTimeouts(process.env);
}

/**
 * The URL path as the API sees it, split into segments: percent-encoding is decoded FIRST (a server routes on the decoded path, so
 * `/crews/a/%73tops` and `/crews/a%2Fstops` reach the stop operation), then split on "/", empty segments dropped. Only ASCII escapes
 * (%00 to %7F) are decoded, and an invalid escape is left as written, as a lenient server does: every character the routes use is
 * ASCII, and nothing here can throw on a hostile path.
 */
export function pathSegmentsOf(pathname: string): string[] {
  const decoded = pathname.replace(/%([0-7][0-9a-fA-F])/g, (_escape, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  return decoded.split("/").filter((segment) => segment !== "");
}

/**
 * Whether a request is a SAFETY request, which is held to UPSTREAM_TIMEOUT_MS: exactly the two Stop operations of the contract,
 * `create_crew_stop` (POST /api/v1/crews/{crew_id}/stops) and `delete_crew_stop` (DELETE /api/v1/crews/{crew_id}/stops/{stop_id}).
 * The crew id is any value (a deployment is not limited to the demo crews). tests/unit/api/upstream-timeouts-contract.test.ts reads
 * openapi/stellar-blaze.openapi.json and fails if the set of operations this accepts is anything else, or if a new `/stops`
 * operation appears that nobody classified.
 */
export function isSafetyRoute(method: string, pathSegments: readonly string[]): boolean {
  const [api, version, crews, , stops, stopId, ...rest] = pathSegments;
  if (api !== "api" || version !== "v1" || crews !== "crews" || stops !== "stops" || rest.length > 0) return false;
  const verb = method.toUpperCase();
  if (verb === "POST") return stopId === undefined;
  if (verb === "DELETE") return stopId !== undefined;
  return false;
}

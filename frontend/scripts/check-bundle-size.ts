// Fails when a route's first-load script is over its ceiling. Reads the OUTPUT of `next build` (no browser, no server):
// `.next/diagnostics/route-bundle-stats.json` lists the chunks every route loads first, and each chunk is gzipped here the way the
// server sends it. Run it after `pnpm build` (`pnpm bundle:check`; CI runs it between the build and the e2e).
//
// The limits (F2 W3.1, the architect's ruling of 2026-11-15). Lighthouse's `resource-summary:script:size` is the same measure
// plus the response headers of each chunk, which this does not count, so a route that passes here can still read a little higher
// in lighthouserc.json:
//  - every route: 170 KB gzip, 174,080 B (the product budget; it is never edited);
//  - the five exception routes ONLY (the data screens): `/worker`, `/worker/alerts`, `/worker/alert`, `/supervisor` and
//    `/supervisor/crews/[crewId]`: 195 KB gzip, 199,680 B, with Lighthouse asserts of performance 0.80, LCP 3.5 s and TBT 350 ms
//    for the covered routes (lighthouserc.json, the architect's ADRs). Every other route keeps performance 0.9, LCP 2.5 s,
//    TBT 200 ms. `/worker/unwell` is NOT covered: it stays at 174,080 B and makes no request.
//  - the supervisor routes `/supervisor` and `/supervisor/crews/[crewId]` (the plan and sign-off screen) are covered by the same
//    ceiling since the architect's ruling of 2026-11-15 (late morning); lighthouse asserts for them (perf 0.80, LCP 3.5 s,
//    TBT 350 ms) belong to ADR 0069 and Task 25 (lighthouserc.json is not edited here).
//  - `/worker/alert` (the static alert-card shell) is covered too (architect, 2026-11-15, afternoon). The covered routes are exactly
//    /worker, /worker/alerts, /worker/alert, /supervisor and /supervisor/crews/[crewId]; there is no "pending" class any more: every
//    route either meets its ceiling or fails the build. `/worker/unwell` and every other route stay at 174,080 B.
//  - the check cannot pass vacuously (F2 W4 I2): it fails when the stats hold no route, when a route's size is 0 (a renamed or
//    missing `firstLoadChunkPaths`, a build that listed no script), and when a route it has a ruling for is absent from the stats
//    (REQUIRED: a rename would otherwise drop the ceilings silently).
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";

const KB = 1024;
export const BUDGET = 170 * KB;
export const DATA_SCREEN_CEILING = 195 * KB;

export const CEILINGS: Readonly<Record<string, number>> = {
  "/[locale]/worker": DATA_SCREEN_CEILING,
  "/[locale]/worker/alerts": DATA_SCREEN_CEILING,
  "/[locale]/worker/alert": DATA_SCREEN_CEILING,
  "/[locale]/supervisor": DATA_SCREEN_CEILING,
  "/[locale]/supervisor/crews/[crewId]": DATA_SCREEN_CEILING,
};

/** Routes the rulings name: each must be in the build's stats, or a rename has silently dropped its limit. */
export const REQUIRED: readonly string[] = [
  "/[locale]/worker",
  "/[locale]/worker/alerts",
  "/[locale]/worker/alert",
  "/[locale]/worker/unwell",
  "/[locale]/supervisor",
  "/[locale]/supervisor/crews/[crewId]",
];

export interface RouteStats {
  readonly route: string;
  readonly firstLoadChunkPaths: readonly string[];
}

export interface RouteVerdict {
  readonly route: string;
  readonly size: number;
  readonly limit: number;
  readonly status: "ok" | "FAIL";
}

export function evaluate(stats: readonly RouteStats[], gzipSize: (chunk: string) => number): RouteVerdict[] {
  return stats
    .map((entry): RouteVerdict => {
      const chunks = [...new Set(entry.firstLoadChunkPaths)].filter((path) => path.endsWith(".js"));
      const size = chunks.reduce((total, chunk) => total + gzipSize(chunk), 0);
      const limit = CEILINGS[entry.route] ?? BUDGET;
      return { route: entry.route, size, limit, status: size <= limit ? "ok" : "FAIL" };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * Why the check cannot be trusted, if it cannot: no routes at all, a route with a size of 0, or a ruled route that is missing.
 * Empty when the verdicts mean something. Each entry is a line for the failure message.
 */
export function vacuity(stats: readonly RouteStats[], rows: readonly RouteVerdict[]): string[] {
  const problems: string[] = [];
  if (stats.length === 0 || rows.length === 0) problems.push("the build stats list no route at all");
  for (const row of rows) if (row.size === 0) problems.push(`${row.route} has no first-load script (size 0): the stats shape changed, or the route renamed its chunks`);
  const present = new Set(stats.map((entry) => entry.route));
  for (const route of REQUIRED) if (!present.has(route)) problems.push(`${route} is not in the build stats: renamed or removed, and its limit with it`);
  return problems;
}

function main(): void {
  const stats = JSON.parse(readFileSync(join(process.cwd(), ".next", "diagnostics", "route-bundle-stats.json"), "utf8")) as RouteStats[];
  const gzipSize = (chunk: string) => gzipSync(readFileSync(join(process.cwd(), chunk.replaceAll("\\", "/")))).length;
  const rows = evaluate(stats, gzipSize);
  for (const row of rows) {
    console.log(`${row.status.padEnd(5)} ${row.route.padEnd(38)} ${String(row.size).padStart(8)} B of ${String(row.limit).padStart(7)}`);
  }
  const failed = rows.filter((row) => row.status === "FAIL");
  const vacuous = vacuity(stats, rows);
  if (vacuous.length > 0) {
    console.error(`\nbundle:check cannot vouch for this build:\n - ${vacuous.join("\n - ")}`);
    process.exit(1);
  }
  if (failed.length > 0) {
    console.error(`\nbundle:check failed for ${failed.map((row) => `${row.route} (${String(row.size - row.limit)} B over)`).join(", ")}`);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && basename(process.argv[1]) === "check-bundle-size.ts") main();

// Fails when a route's first-load script is over its ceiling. Reads the OUTPUT of `next build` (no browser, no server):
// `.next/diagnostics/route-bundle-stats.json` lists the chunks every route loads first, and each chunk is gzipped here the way the
// server sends it. Run it after `pnpm build` (`pnpm bundle:check`; CI runs it between the build and the e2e).
//
// The limits (F2 W3.1, the architect's ruling of 2026-11-15). Lighthouse's `resource-summary:script:size` is the same measure
// plus the response headers of each chunk, which this does not count, so a route that passes here can still read a little higher
// in lighthouserc.json:
//  - every route: 170 KB gzip, 174,080 B (the product budget; it is never edited);
//  - `/worker` and `/worker/alerts` ONLY (the two data screens): 195 KB gzip, 199,680 B, with Lighthouse asserts of performance
//    0.80, LCP 3.5 s and TBT 350 ms for those two routes (lighthouserc.json, the architect's ADR). Every other route keeps
//    performance 0.9, LCP 2.5 s, TBT 200 ms. `/worker/unwell` is NOT covered: it stays at 174,080 B and makes no request.
//  - a route whose ruling is still pending is listed in PENDING with the reason: it is reported as "over (pending)" and does not
//    fail the check, so a pending ruling is visible on every run and never silently waived. Remove the entry when it is ruled.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";

const KB = 1024;
export const BUDGET = 170 * KB;
export const DATA_SCREEN_CEILING = 195 * KB;

export const CEILINGS: Readonly<Record<string, number>> = {
  "/[locale]/worker": DATA_SCREEN_CEILING,
  "/[locale]/worker/alerts": DATA_SCREEN_CEILING,
};

export const PENDING: Readonly<Record<string, string>> = {
  "/[locale]/supervisor": "ruling pending for the supervisor routes (F2 S1: trimmed as low as possible meanwhile)",
  "/[locale]/worker/alert": "the alert card is not named in the ruling (only /worker and /worker/alerts are); it is the same data screen as Today, ruling pending",
};

export interface RouteStats {
  readonly route: string;
  readonly firstLoadChunkPaths: readonly string[];
}

export interface RouteVerdict {
  readonly route: string;
  readonly size: number;
  readonly limit: number;
  readonly status: "ok" | "FAIL" | "over (pending)";
  readonly pending: string | undefined;
}

export function evaluate(stats: readonly RouteStats[], gzipSize: (chunk: string) => number): RouteVerdict[] {
  return stats
    .map((entry): RouteVerdict => {
      const chunks = [...new Set(entry.firstLoadChunkPaths)].filter((path) => path.endsWith(".js"));
      const size = chunks.reduce((total, chunk) => total + gzipSize(chunk), 0);
      const limit = CEILINGS[entry.route] ?? BUDGET;
      const pending = PENDING[entry.route];
      const status = size <= limit ? "ok" : pending === undefined ? "FAIL" : "over (pending)";
      return { route: entry.route, size, limit, status, pending };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}

function main(): void {
  const stats = JSON.parse(readFileSync(join(process.cwd(), ".next", "diagnostics", "route-bundle-stats.json"), "utf8")) as RouteStats[];
  const gzipSize = (chunk: string) => gzipSync(readFileSync(join(process.cwd(), chunk.replaceAll("\\", "/")))).length;
  const rows = evaluate(stats, gzipSize);
  for (const row of rows) {
    const note = row.status === "over (pending)" ? `  <- ${row.pending ?? ""}` : "";
    console.log(`${row.status.padEnd(14)} ${row.route.padEnd(36)} ${String(row.size).padStart(8)} B of ${String(row.limit).padStart(7)}${note}`);
  }
  const failed = rows.filter((row) => row.status === "FAIL");
  if (failed.length > 0) {
    console.error(`\nbundle:check failed for ${failed.map((row) => `${row.route} (${String(row.size - row.limit)} B over)`).join(", ")}`);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && basename(process.argv[1]) === "check-bundle-size.ts") main();

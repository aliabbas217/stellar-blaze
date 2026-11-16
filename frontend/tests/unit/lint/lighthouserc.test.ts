import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUDGET, CEILINGS, DATA_SCREEN_CEILING } from "../../../scripts/check-bundle-size.ts";

/*
 * lighthouserc.json is the CI half of the route budgets (ADR 0069): the byte limits and the Lighthouse asserts of every route
 * the demo shows. It is checked here, not by eye, because `matchingUrlPattern` is an UNANCHORED regex in lhci: a bare
 * `/en/worker` also matches `/en/worker/alerts`, and a URL no entry matches is asserted against nothing (it passes).
 *   - every collected URL is matched by EXACTLY ONE entry (none unasserted, none asserted twice with different terms);
 *   - the script-size limit of each entry equals what `pnpm bundle:check` enforces for the same route (one budget, two gates);
 *   - the exempt routes in the rc are exactly the ones in scripts/check-bundle-size.ts;
 *   - the terms of ADR 0069 and the plan's matrix;
 *   - `--no-sandbox` is a CI workflow flag only (ADR 0063), never in the rc.
 */

interface Assertion {
  readonly minScore?: number;
  readonly maxNumericValue?: number;
  readonly aggregationMethod?: string;
}
interface Entry {
  readonly matchingUrlPattern: string;
  readonly assertions: Readonly<Record<string, readonly [string, Assertion]>>;
}
interface Rc {
  readonly ci: {
    readonly collect: { readonly url: readonly string[]; readonly numberOfRuns: number };
    readonly assert: { readonly assertMatrix: readonly Entry[] };
  };
}

const text = readFileSync(join(process.cwd(), "lighthouserc.json"), "utf8");
const rc = JSON.parse(text) as Rc;
const BASE = "http://127.0.0.1:3000";
const urls = rc.ci.collect.url;
const matrix = rc.ci.assert.assertMatrix;

const matching = (url: string): Entry[] => matrix.filter((entry) => new RegExp(entry.matchingUrlPattern).test(url));
const limit = (entry: Entry, name: string): number => {
  const value = entry.assertions[name]?.[1].maxNumericValue ?? entry.assertions[name]?.[1].minScore;
  if (value === undefined) throw new Error(`${entry.matchingUrlPattern} has no ${name}`);
  return value;
};
const pathOf = (url: string): string => url.slice(BASE.length);

/** The bundle:check route key of a collected URL (`/en/worker?site=...` is the route `/[locale]/worker`). */
function routeKey(url: string): string {
  const path = pathOf(url).split("?")[0] ?? "";
  return path.replace(/^\/en/, "/[locale]").replace(/^\/\[locale\]\/supervisor\/crews\/[^/]+$/, "/[locale]/supervisor/crews/[crewId]").replace(/^\/\[locale\]\/replay\/proof\/.+$/, "/[locale]/replay/proof/[claim]");
}

describe("lighthouserc.json: the per-URL matrix of ADR 0069", () => {
  it("collects the whole demo: landing (both paths), the five judge pages, the worker pages incl. the pinned Today and the alert card, both supervisor screens", () => {
    expect(urls.map(pathOf)).toEqual([
      "/en",
      "/en?static",
      "/en/replay",
      "/en/replay/day",
      "/en/replay/try",
      "/en/replay/governance",
      "/en/replay/proof/forecast.hours_over_limit",
      "/en/worker",
      "/en/worker?site=site-demo-mussafah&crew=crew-b",
      "/en/worker/alerts",
      "/en/worker/alert?audience=site&target=site-demo-mussafah&level=orange&valid_from=2026-09-03T06%3A00%3A00Z",
      "/en/worker/unwell",
      "/en/supervisor",
      "/en/supervisor/crews/crew-b",
    ]);
    expect(rc.ci.collect.numberOfRuns).toBe(3);
  });

  it("matches every URL with exactly one entry (an unanchored pattern would double up, a missing one would assert nothing)", () => {
    for (const url of urls) expect(matching(url).length, url).toBe(1);
  });

  it("anchors every pattern (^ and $)", () => {
    for (const entry of matrix) expect(entry.matchingUrlPattern, entry.matchingUrlPattern).toMatch(/^\^.*\$$/);
  });

  it("holds each route to the script-size limit that `bundle:check` enforces for it: 199,680 B on the five exempt routes, 174,080 B elsewhere", () => {
    expect(DATA_SCREEN_CEILING).toBe(199_680);
    expect(BUDGET).toBe(174_080);
    for (const url of urls) {
      const [entry] = matching(url);
      const expected = CEILINGS[routeKey(url)] ?? BUDGET;
      expect(limit(entry as Entry, "resource-summary:script:size"), url).toBe(expected);
    }
  });

  it("the exempt routes in the rc are exactly the ones in scripts/check-bundle-size.ts", () => {
    const exemptInRc = new Set(urls.filter((url) => limit(matching(url)[0] as Entry, "resource-summary:script:size") === DATA_SCREEN_CEILING).map(routeKey));
    expect([...exemptInRc].sort()).toEqual(Object.keys(CEILINGS).sort());
  });

  it("applies the terms of ADR 0069: worker routes 0.80 / 3.5 s / 350 ms, supervisor 0.75 / 4.0 s / 450 ms, landing 0.80 / 3.0 s, everything else 0.90 / 2.5 s / 200 ms; CLS 0.1 and accessibility 1 on all", () => {
    const terms = (path: string): number[] => {
      const url = `${BASE}${path}`;
      const entry = matching(url)[0] as Entry;
      return [limit(entry, "categories:performance"), limit(entry, "largest-contentful-paint"), limit(entry, "total-blocking-time")];
    };
    for (const path of ["/en/worker", "/en/worker?site=site-demo-mussafah&crew=crew-b", "/en/worker/alerts", "/en/worker/alert?audience=site&target=x&level=orange&valid_from=y"]) {
      expect(terms(path), path).toEqual([0.8, 3500, 350]);
    }
    for (const path of ["/en/supervisor", "/en/supervisor/crews/crew-b"]) expect(terms(path), path).toEqual([0.75, 4000, 450]);
    expect(terms("/en")).toEqual([0.8, 3000, 200]);
    for (const path of ["/en?static", "/en/replay", "/en/replay/day", "/en/replay/try", "/en/replay/governance", "/en/replay/proof/a.b", "/en/worker/unwell"]) {
      expect(terms(path), path).toEqual([0.9, 2500, 200]);
    }
    for (const entry of matrix) {
      expect(limit(entry, "cumulative-layout-shift")).toBe(0.1);
      expect(limit(entry, "categories:accessibility")).toBe(1);
    }
  });

  it("asserts every term as the median of the runs, as an error", () => {
    for (const entry of matrix) {
      for (const [name, [level, options]] of Object.entries(entry.assertions)) {
        expect(level, name).toBe("error");
        expect(options.aggregationMethod, name).toBe("median-run");
      }
    }
  });

  it("does not hold `--no-sandbox` (ADR 0063: it belongs to the CI workflow command only)", () => {
    expect(text).not.toMatch(/no-sandbox/);
  });
});

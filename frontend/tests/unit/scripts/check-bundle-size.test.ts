import { BUDGET, CEILINGS, DATA_SCREEN_CEILING, REQUIRED, evaluate, vacuity } from "../../../scripts/check-bundle-size.ts";

/*
 * F2 W3.1: the build-output size check. The numbers are the architect's ruling: 174,080 B for every route, 199,680 B (195 KB)
 * for `/worker` and `/worker/alerts` only; the unwell sheet and everything else keep the product budget.
 */

const sizes: Record<string, number> = {};
const gzip = (chunk: string) => sizes[chunk] ?? 0;
const stat = (route: string, bytes: number) => {
  sizes[`c-${route}.js`] = bytes;
  return { route, firstLoadChunkPaths: [`c-${route}.js`, `c-${route}.js`] };
};

describe("check-bundle-size", () => {
  it("the limits are 170 KB and 195 KB gzip, 195 KB for exactly the two data screens", () => {
    expect(BUDGET).toBe(174_080);
    expect(DATA_SCREEN_CEILING).toBe(199_680);
    expect(Object.keys(CEILINGS).sort()).toEqual([
      "/[locale]/supervisor",
      "/[locale]/supervisor/crews/[crewId]",
      "/[locale]/worker",
      "/[locale]/worker/alert",
      "/[locale]/worker/alerts",
    ]);
  });

  it("lets the two data screens up to 195 KB and fails them above", () => {
    const byRoute = Object.fromEntries(
      evaluate([stat("/[locale]/worker", 199_680), stat("/[locale]/worker/alerts", 199_681)], gzip).map((row) => [row.route, row.status]),
    );
    expect(byRoute["/[locale]/worker"]).toBe("ok");
    expect(byRoute["/[locale]/worker/alerts"]).toBe("FAIL");
  });

  it("keeps the unwell sheet and every other route at the product budget", () => {
    const rows = evaluate([stat("/[locale]/worker/unwell", 174_081), stat("/[locale]/replay", 174_080), stat("/[locale]", 180_000)], gzip);
    const byRoute = Object.fromEntries(rows.map((row) => [row.route, row.status]));
    expect(byRoute["/[locale]/worker/unwell"]).toBe("FAIL");
    expect(byRoute["/[locale]/replay"]).toBe("ok");
    expect(byRoute["/[locale]"]).toBe("FAIL");
  });

  it("counts a chunk once however often a route lists it, and ignores non-script files", () => {
    sizes["a.js"] = 100;
    sizes["b.css"] = 5_000;
    const [row] = evaluate([{ route: "/[locale]/x", firstLoadChunkPaths: ["a.js", "a.js", "b.css"] }], gzip);
    expect(row?.size).toBe(100);
  });

  it("W4 I3: the supervisor list and plan routes get the 195 KB ceiling (the architect's extension), and fail above it", () => {
    const rows = evaluate(
      [stat("/[locale]/supervisor", 199_680), stat("/[locale]/supervisor/crews/[crewId]", 199_680), stat("/[locale]/supervisor/other", 199_680)],
      gzip,
    );
    const byRoute = Object.fromEntries(rows.map((row) => [row.route, row.status]));
    expect(byRoute["/[locale]/supervisor"]).toBe("ok");
    expect(byRoute["/[locale]/supervisor/crews/[crewId]"]).toBe("ok");
    // a supervisor route nobody ruled on keeps the product budget
    expect(byRoute["/[locale]/supervisor/other"]).toBe("FAIL");
    const over = evaluate([stat("/[locale]/supervisor", 199_681), stat("/[locale]/supervisor/crews/[crewId]", 199_681)], gzip);
    expect(over.map((row) => row.status)).toEqual(["FAIL", "FAIL"]);
  });

  it("the alert card shell has the same ceiling and fails above it: there is no pending class left", () => {
    const rows = evaluate([stat("/[locale]/worker/alert", 199_680), stat("/[locale]/worker/alerts", 199_681)], gzip);
    expect(rows.map((row) => row.status)).toEqual(["ok", "FAIL"]);
    expect(evaluate([stat("/[locale]/worker/alert", 199_681)], gzip)[0]?.status).toBe("FAIL");
    for (const row of evaluate([stat("/[locale]/worker/alert", BUDGET + 1)], gzip)) expect(Object.keys(row)).not.toContain("pending");
  });
});

describe("check-bundle-size cannot pass vacuously (W4 I2)", () => {
  const present = (sizeOf: (route: string) => number) => {
    const stats = REQUIRED.map((route) => stat(route, sizeOf(route)));
    return { stats, rows: evaluate(stats, gzip) };
  };

  it("is clean for a build that lists every ruled route with a size", () => {
    const { stats, rows } = present(() => 150_000);
    expect(vacuity(stats, rows)).toEqual([]);
  });

  it("fails when the stats list no route at all (an empty file would otherwise exit 0)", () => {
    expect(vacuity([], evaluate([], gzip))).toContain("the build stats list no route at all");
  });

  it("fails when a route's size is 0 (a missing or renamed `firstLoadChunkPaths` counts nothing and would read ok)", () => {
    const { stats, rows } = present((route) => (route === "/[locale]/worker" ? 0 : 150_000));
    expect(rows.find((row) => row.route === "/[locale]/worker")?.status).toBe("ok");
    expect(vacuity(stats, rows).join("\n")).toContain("/[locale]/worker has no first-load script");
  });

  it.each(REQUIRED)("fails when %s is absent from the stats (a rename would drop its ceiling)", (route) => {
    const stats = REQUIRED.filter((name) => name !== route).map((name) => stat(name, 150_000));
    const problems = vacuity(stats, evaluate(stats, gzip));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${route} is not in the build stats`);
  });

  it("names the unwell sheet, the three worker data screens and both supervisor routes", () => {
    expect([...REQUIRED].sort()).toEqual([
      "/[locale]/supervisor",
      "/[locale]/supervisor/crews/[crewId]",
      "/[locale]/worker",
      "/[locale]/worker/alert",
      "/[locale]/worker/alerts",
      "/[locale]/worker/unwell",
    ]);
  });
});

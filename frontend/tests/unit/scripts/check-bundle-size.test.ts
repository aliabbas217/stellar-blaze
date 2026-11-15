import { BUDGET, CEILINGS, DATA_SCREEN_CEILING, PENDING, evaluate } from "../../../scripts/check-bundle-size.ts";

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
    expect(Object.keys(CEILINGS).sort()).toEqual(["/[locale]/worker", "/[locale]/worker/alerts"]);
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

  it("reports a route with a pending ruling as over, never as ok and never as a failure", () => {
    const route = Object.keys(PENDING)[0] ?? "";
    const [row] = evaluate([stat(route, BUDGET + 10)], gzip);
    expect(row?.status).toBe("over (pending)");
  });
});

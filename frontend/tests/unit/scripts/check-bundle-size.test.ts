import { BUDGET, CEILINGS, DATA_SCREEN_CEILING, REQUIRED, SCENE_CEILING, evaluate, lazyScene, sceneVerdict, vacuity } from "../../../scripts/check-bundle-size.ts";

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

  it("names the landing page, the unwell sheet, the three worker data screens and both supervisor routes", () => {
    expect([...REQUIRED].sort()).toEqual([
      "/[locale]",
      "/[locale]/supervisor",
      "/[locale]/supervisor/crews/[crewId]",
      "/[locale]/worker",
      "/[locale]/worker/alert",
      "/[locale]/worker/alerts",
      "/[locale]/worker/unwell",
    ]);
  });
});

describe("check-bundle-size gates the lazy 3D scene (Part L1 I3)", () => {
  // The shape Turbopack writes for a module worker: the page-side scene chunk names the worker's bootstrap chunk and the chunks it
  // imports; the bootstrap lists them in `.f("static/chunks/turbopack-worker-<hash>.js",[ ...chunks ])`.
  const SCENE = "static/chunks/scene.js";
  const WORKER = "static/chunks/turbopack-worker-x.js";
  const SCENE_TEXT = `e.q("/_next/static/media/OES_standard_derivatives.abc")},11343,e=>{e.v(e.r(10914).f("${WORKER}",["static/chunks/w1.js","static/chunks/turbopack-runtime.js"]))}`;
  const FILES: Record<string, string> = {
    [SCENE]: SCENE_TEXT,
    [WORKER]: "worker bootstrap",
    "static/chunks/w1.js": "worker code",
    "static/chunks/turbopack-runtime.js": "runtime (also loaded by the page)",
    "static/chunks/other.js": "something else",
  };
  const gz = (bytes: Record<string, number>) => (chunk: string) => bytes[chunk] ?? 0;
  const read = (files: Record<string, string>) => (chunk: string) => files[chunk];
  const list = (files: Record<string, string>) => Object.keys(files);

  it("names the ceiling: 22 KB gzip, as a constant", () => {
    expect(SCENE_CEILING).toBe(22_528);
  });

  it("finds the scene chunk by the extension name it carries, the worker bootstrap and every chunk it imports, and sums them once", () => {
    const bytes = { [SCENE]: 2_300, [WORKER]: 400, "static/chunks/w1.js": 5_300, "static/chunks/turbopack-runtime.js": 4_000 };
    const found = lazyScene(list(FILES), read(FILES), gz(bytes), []);
    expect(found.chunks.sort()).toEqual([SCENE, "static/chunks/turbopack-runtime.js", "static/chunks/w1.js", WORKER].sort());
    expect(found.size).toBe(2_300 + 400 + 5_300 + 4_000);
    expect(found.problems).toEqual([]);
    expect(found.size).toBeLessThanOrEqual(SCENE_CEILING);
  });

  it("does not count again a chunk the route already loads first (the runtime is in the first-load check)", () => {
    const bytes = { [SCENE]: 2_300, [WORKER]: 400, "static/chunks/w1.js": 5_300, "static/chunks/turbopack-runtime.js": 4_000 };
    const found = lazyScene(list(FILES), read(FILES), gz(bytes), [String.raw`.next\static\chunks\turbopack-runtime.js`]);
    expect(found.chunks).not.toContain("static/chunks/turbopack-runtime.js");
    expect(found.size).toBe(2_300 + 400 + 5_300);
  });

  it("fails above the ceiling and passes at it", () => {
    const at = lazyScene(list(FILES), read(FILES), gz({ [SCENE]: SCENE_CEILING - 3, [WORKER]: 1, "static/chunks/w1.js": 1, "static/chunks/turbopack-runtime.js": 1 }), []);
    expect(at.size).toBe(SCENE_CEILING);
    expect(sceneVerdict(at)).toBe("ok");
    const over = lazyScene(list(FILES), read(FILES), gz({ [SCENE]: SCENE_CEILING - 2, [WORKER]: 1, "static/chunks/w1.js": 1, "static/chunks/turbopack-runtime.js": 1 }), []);
    expect(sceneVerdict(over)).toBe("FAIL");
  });

  it("cannot pass vacuously: no chunk carries the scene marker, or a named chunk is missing or empty", () => {
    const none = lazyScene(list({ "static/chunks/other.js": "x" }), read({ "static/chunks/other.js": "x" }), gz({ "static/chunks/other.js": 10 }), []);
    expect(none.problems.join("\n")).toContain("no chunk references the WebGL scene");
    expect(none.size).toBe(0);

    // the scene has no worker: a chunk that carries the marker and names no bootstrap is the whole scene, counted alone
    const noBootstrap = { ...FILES, [SCENE]: 'e.q("OES_standard_derivatives")' };
    const a = lazyScene(list(noBootstrap), read(noBootstrap), gz({ [SCENE]: 100 }), []);
    expect(a.problems).toEqual([]);
    expect(a.size).toBe(100);

    const bytes = { [SCENE]: 2_300, [WORKER]: 400, "static/chunks/w1.js": 0, "static/chunks/turbopack-runtime.js": 4_000 };
    const b = lazyScene(list(FILES), read(FILES), gz(bytes), []);
    expect(b.problems.join("\n")).toContain("static/chunks/w1.js has no content");

    const missing = Object.fromEntries(Object.entries(FILES).filter(([chunk]) => chunk !== "static/chunks/w1.js"));
    const c = lazyScene(list(missing), read(missing), gz({ [SCENE]: 1, [WORKER]: 1 }), []);
    expect(c.problems.join("\n")).toContain("static/chunks/w1.js is named by the scene chunk but is not in the build");
  });
});

import { compareRegistered, registeredFromListing } from "../../../scripts/check-e2e-registered.mjs";

/*
 * The registered-tests check (scripts/check-e2e-registered.mjs): a test that stops being registered must fail the check, not
 * pass unnoticed (commit 8962cd1 closed a describe block early and three tests silently stopped existing while tsc, lint and the
 * rest of the suite stayed green).
 */

type Registered = Record<string, Record<string, string[]>>;

const manifest: Registered = {
  "a.spec.ts": { "mobile-chromium": ["group > one", "group > two", "three"], "desktop-chromium": ["group > one", "group > two", "three"] },
  "b.spec.ts": { "mobile-chromium": ["only"] },
};
const copy = (): Registered => JSON.parse(JSON.stringify(manifest)) as Registered;

describe("compareRegistered", () => {
  it("passes when what is registered is what the manifest says", () => {
    expect(compareRegistered(copy(), manifest)).toEqual([]);
  });

  it("fails on a dropped test, naming the file, the project and the title", () => {
    const actual = copy();
    (actual["a.spec.ts"] as Record<string, string[]>)["mobile-chromium"] = ["group > one", "three"];
    const problems = compareRegistered(actual, manifest);
    expect(problems.some((p) => p.includes("a.spec.ts [mobile-chromium]") && p.includes("MISSING") && p.includes("group > two"))).toBe(true);
    expect(problems.some((p) => p.includes("3 registered in the manifest, 2 now"))).toBe(true);
  });

  it("fails on an added test", () => {
    const actual = copy();
    (actual["b.spec.ts"] as Record<string, string[]>)["mobile-chromium"] = ["only", "new one"];
    const problems = compareRegistered(actual, manifest);
    expect(problems.some((p) => p.includes("b.spec.ts [mobile-chromium]") && p.includes("EXTRA") && p.includes("new one"))).toBe(true);
  });

  it("fails on a renamed test (one missing and one extra, same count)", () => {
    const actual = copy();
    (actual["a.spec.ts"] as Record<string, string[]>)["desktop-chromium"] = ["group > one", "group > 2", "three"];
    const problems = compareRegistered(actual, manifest);
    expect(problems.filter((p) => p.includes("MISSING")).length).toBe(1);
    expect(problems.filter((p) => p.includes("EXTRA")).length).toBe(1);
    expect(problems.some((p) => p.includes("registered in the manifest"))).toBe(false);
  });

  it("fails on a changed count that keeps every title (a duplicated title)", () => {
    const actual = copy();
    (actual["a.spec.ts"] as Record<string, string[]>)["mobile-chromium"] = ["group > one", "group > two", "three", "three"];
    const problems = compareRegistered(actual, manifest);
    expect(problems.some((p) => p.includes("3 registered in the manifest, 4 now"))).toBe(true);
    expect(problems.some((p) => p.includes("EXTRA") && p.includes("three"))).toBe(true);
  });

  it("fails on a whole project that stopped running a spec", () => {
    const actual = copy();
    delete (actual["a.spec.ts"] as Record<string, string[]>)["desktop-chromium"];
    const problems = compareRegistered(actual, manifest);
    expect(problems.some((p) => p.includes("a.spec.ts [desktop-chromium]") && p.includes("3 registered in the manifest, 0 now"))).toBe(true);
  });

  it("fails on a spec file that vanished, and on one the manifest does not know", () => {
    const actual = copy();
    delete actual["b.spec.ts"];
    actual["c.spec.ts"] = { "mobile-chromium": ["x"] };
    const problems = compareRegistered(actual, manifest);
    expect(problems.some((p) => p.startsWith("b.spec.ts:") && p.includes("NOTHING is registered"))).toBe(true);
    expect(problems.some((p) => p.startsWith("c.spec.ts:") && p.includes("not in the manifest"))).toBe(true);
  });
});

describe("registeredFromListing: the Playwright JSON tree", () => {
  const listing = {
    suites: [
      {
        title: "a.spec.ts",
        file: "a.spec.ts",
        specs: [{ title: "top level", file: "a.spec.ts", tests: [{ projectName: "mobile-chromium" }, { projectName: "desktop-chromium" }] }],
        suites: [
          {
            title: "group",
            file: "a.spec.ts",
            specs: [{ title: "inner", file: "a.spec.ts", tests: [{ projectName: "mobile-chromium" }] }],
            suites: [{ title: "deeper", file: "a.spec.ts", specs: [{ title: "leaf", file: "a.spec.ts", tests: [{ projectName: "desktop-chromium" }] }] }],
          },
        ],
      },
    ],
  };

  it("names a test by its describe path and groups by file and project, titles sorted", () => {
    expect(registeredFromListing(listing)).toEqual({
      "a.spec.ts": { "mobile-chromium": ["group > inner", "top level"], "desktop-chromium": ["group > deeper > leaf", "top level"] },
    });
  });

  it("a truncated file (a describe closed too early drops its tests) lists fewer, and the comparison fails: the check is not vacuous", () => {
    const full = registeredFromListing(listing);
    const truncated = registeredFromListing({ suites: [{ ...listing.suites[0], suites: [] }] });
    expect(compareRegistered(truncated, full).length).toBeGreaterThan(0);
  });
});

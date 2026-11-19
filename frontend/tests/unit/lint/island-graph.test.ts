import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { valueImports } from "./import-graph";

/*
 * The first-load graph of the two judge pages that call the API must contain no TanStack Query and no demo context: both live
 * in a lazy island that the page loads on the first interaction (features/judge/live/useIslandGate.ts). TanStack Query alone is
 * about 18.7 KB gzip and put /replay/governance at 179,841 B against the 174,080 B route budget.
 *
 * The walk follows STATIC value imports only (a dynamic `import()` is the island boundary: a separate chunk). It starts at the
 * route's page and at every layout above it, so a provider added back to the `(live)` layout fails here. Verified against a
 * production build too: the lhci numbers in the F2 report, and `scripts` output of the route's chunks.
 */

const SRC = resolve(import.meta.dirname, "../../../src");
const LIVE = join(SRC, "app/[locale]/(judge)/replay/(live)");
const FORBIDDEN_SPEC = /^@tanstack\//;
const FORBIDDEN_FILES = ["providers/QueryProvider", "features/demo/DemoProvider", "features/demo/DemoSwitch", "features/demo/sites"];

const ALL = new Set(
  (function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  })(SRC),
);

function resolveSpecifier(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(from, "..", spec) : null;
  if (base === null) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) if (ALL.has(candidate)) return candidate;
  return null;
}

/** Static value imports only: `import("...")` is the island boundary. */
function staticImports(source: string): string[] {
  const dynamic = new Set([...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]));
  const all = valueImports(source);
  const remaining = [...all];
  for (const spec of dynamic) {
    const at = remaining.indexOf(spec as string);
    if (at >= 0) remaining.splice(at, 1);
  }
  return remaining;
}

const rel = (file: string): string => relative(SRC, file).replaceAll("\\", "/");

/** The chain of files from the roots to the first forbidden module, or null. */
export function firstLoadViolation(roots: readonly string[], read: (file: string) => string = (f) => readFileSync(f, "utf8")): string[] | null {
  const seen = new Set<string>();
  const visit = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    for (const spec of staticImports(read(file))) {
      if (FORBIDDEN_SPEC.test(spec)) return [...chain, spec];
      const next = resolveSpecifier(file, spec);
      if (next === null) continue;
      if (FORBIDDEN_FILES.some((f) => rel(next).startsWith(f))) return [...chain, rel(next)];
      const hit = visit(next, [...chain, rel(next)]);
      if (hit !== null) return hit;
    }
    return null;
  };
  for (const root of roots) {
    const hit = visit(root, [rel(root)]);
    if (hit !== null) return hit;
  }
  return null;
}

// Every layout above a page (the app has no root layout above [locale]): the locale layout, the judge shell and the (live) group. A provider added to any of them fails here.
const LAYOUTS = [join(SRC, "app/[locale]/layout.tsx"), join(SRC, "app/[locale]/(judge)/replay/layout.tsx"), join(LIVE, "layout.tsx")];
const PAGES = ["governance/page.tsx", "try/page.tsx"].map((p) => join(LIVE, p)).filter((p) => existsSync(p));

describe("the first-load graph of the judge pages that call the API", () => {
  it("covers the governance page (the scan is not vacuous)", () => {
    expect(PAGES.map(rel)).toContain("app/[locale]/(judge)/replay/(live)/governance/page.tsx");
  });

  it.each(PAGES.map((page) => [rel(page), page] as const))("%s reaches no @tanstack/*, query provider or demo context", (_name, page) => {
    expect(firstLoadViolation([...LAYOUTS, page])).toBeNull();
  });

  it("walks the locale layout too, not only the judge layouts (the scan covers every layout above a page)", () => {
    expect(existsSync(join(SRC, "app/layout.tsx"))).toBe(false);
    expect(LAYOUTS.map(rel)).toEqual(["app/[locale]/layout.tsx", "app/[locale]/(judge)/replay/layout.tsx", "app/[locale]/(judge)/replay/(live)/layout.tsx"]);
    for (const layout of LAYOUTS) expect(existsSync(layout)).toBe(true);
  });

  it.each([
    ["governance", "features/judge/governance/GovernanceGate.tsx", "./GovernanceIsland", "features/judge/governance/GovernanceIsland.tsx"],
    ["try", "features/judge/validator/TryGate.tsx", "./TryIsland", "features/judge/validator/TryIsland.tsx"],
  ])("the %s island IS reached, but only through a dynamic import (a separate chunk)", (_name, gatePath, spec, islandPath) => {
    const gate = join(SRC, gatePath);
    expect(valueImports(readFileSync(gate, "utf8"))).toContain(spec);
    expect(staticImports(readFileSync(gate, "utf8"))).not.toContain(spec);
    // the island itself is what carries TanStack Query: reached statically it would be a violation, so the dynamic edge is the only guard
    expect(firstLoadViolation([join(SRC, islandPath)])).not.toBeNull();
  });

  it("fails on the leak it guards: a provider mounted in the (live) layout", () => {
    const layout = join(LIVE, "layout.tsx");
    const text = (file: string): string => (file === layout ? 'import { QueryProvider } from "@/providers/QueryProvider";\n' : readFileSync(file, "utf8"));
    expect(firstLoadViolation([layout], text)).toEqual([rel(layout), "providers/QueryProvider.tsx"]);
  });
});

// The landing page (`/[locale]`) is static and public: no TanStack Query and no provider at first load, and the WebGL scene is
// a separate chunk the stage brings in after first paint (features/judge/landing/ForecastStage.tsx), never part of the first load.
const LANDING = join(SRC, "app/[locale]/page.tsx");
const LANDING_DIR = join(SRC, "features/judge/landing");

describe("the first-load graph of the landing page", () => {
  it("is not vacuous: the page, the stage and the scene exist", () => {
    expect(existsSync(LANDING)).toBe(true);
    expect(existsSync(join(LANDING_DIR, "ForecastStage.tsx"))).toBe(true);
    expect(existsSync(join(LANDING_DIR, "landing-scene.ts"))).toBe(true);
  });

  it("reaches no @tanstack/*, query provider or demo context from the locale layout and the page", () => {
    expect(firstLoadViolation([join(SRC, "app/[locale]/layout.tsx"), LANDING])).toBeNull();
  });

  it("reaches the WebGL scene only through a dynamic import, from the stage and nowhere else", () => {
    const stage = readFileSync(join(LANDING_DIR, "ForecastStage.tsx"), "utf8");
    expect(valueImports(stage)).toContain("./landing-scene");
    expect(staticImports(stage)).not.toContain("./landing-scene");
    const view = readFileSync(join(LANDING_DIR, "LandingView.tsx"), "utf8");
    expect(staticImports(view)).not.toContain("./landing-scene");
    expect(staticImports(readFileSync(LANDING, "utf8"))).not.toContain("@/features/judge/landing/landing-scene");
    // nothing outside the landing feature imports the scene, and inside it only the stage does
    const importers = [...ALL].filter((file) => {
      if (file.includes("tests")) return false;
      return valueImports(readFileSync(file, "utf8")).some((spec) => /landing-scene/.test(spec));
    });
    expect(importers.map(rel)).toEqual(["features/judge/landing/ForecastStage.tsx"]);
  });

  it("fails on the leak it guards: a provider imported by the landing page", () => {
    const text = (file: string): string => (file === LANDING ? 'import { QueryProvider } from "@/providers/QueryProvider";' : readFileSync(file, "utf8"));
    expect(firstLoadViolation([LANDING], text)).toEqual([rel(LANDING), "providers/QueryProvider.tsx"]);
  });
});

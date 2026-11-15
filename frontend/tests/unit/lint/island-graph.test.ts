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

const LAYOUTS = [join(SRC, "app/[locale]/(judge)/replay/layout.tsx"), join(LIVE, "layout.tsx")];
const PAGES = ["governance/page.tsx", "try/page.tsx"].map((p) => join(LIVE, p)).filter((p) => existsSync(p));

describe("the first-load graph of the judge pages that call the API", () => {
  it("covers the governance page (the scan is not vacuous)", () => {
    expect(PAGES.map(rel)).toContain("app/[locale]/(judge)/replay/(live)/governance/page.tsx");
  });

  it.each(PAGES.map((page) => [rel(page), page] as const))("%s reaches no @tanstack/*, query provider or demo context", (_name, page) => {
    expect(firstLoadViolation([...LAYOUTS, page])).toBeNull();
  });

  it("the island IS reached, but only through a dynamic import (a separate chunk)", () => {
    const gate = join(SRC, "features/judge/governance/GovernanceGate.tsx");
    expect(valueImports(readFileSync(gate, "utf8"))).toContain("./GovernanceIsland");
    expect(staticImports(readFileSync(gate, "utf8"))).not.toContain("./GovernanceIsland");
    expect(firstLoadViolation([join(SRC, "features/judge/governance/GovernanceIsland.tsx")])).not.toBeNull();
  });

  it("fails on the leak it guards: a provider mounted in the (live) layout", () => {
    const layout = join(LIVE, "layout.tsx");
    const text = (file: string): string => (file === layout ? 'import { QueryProvider } from "@/providers/QueryProvider";\n' : readFileSync(file, "utf8"));
    expect(firstLoadViolation([layout], text)).toEqual([rel(layout), "providers/QueryProvider.tsx"]);
  });
});

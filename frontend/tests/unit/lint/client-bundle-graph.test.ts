import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { valueImports } from "./import-graph";

/*
 * No client entry of the judge routes may reach `zod`. A `"use client"` file's whole import graph ships to the browser, and a
 * value import of a schema module put a 36 KB gzip chunk on /replay/governance (F-gov feature review C1: the route went
 * 33.9 KB over its budget). Server-only code (loaders, the exporter shape checks) may use zod; the client takes plain types
 * from a module that imports nothing.
 *
 * Roots: every "use client" file that a file under `src/features/judge/**` or the `(judge)` route group reaches (server
 * pages included: a server file importing a client component is where the browser graph starts). Edges:
 * value imports and dynamic imports, relative and `@/` (type-only imports vanish at build and are skipped).
 */

const SRC = resolve(import.meta.dirname, "../../../src");
const FORBIDDEN = /^zod(\/|$)/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const ALL = new Set(walk(SRC));

function resolveSpecifier(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(from, "..", spec) : null;
  if (base === null) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (ALL.has(candidate)) return candidate;
  }
  return null;
}

/** The chain of files from `root` to the first forbidden package, or null. */
export function reachesForbidden(root: string, read: (file: string) => string = (f) => readFileSync(f, "utf8")): string[] | null {
  const seen = new Set<string>();
  const visit = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    for (const spec of valueImports(read(file))) {
      if (FORBIDDEN.test(spec)) return [...chain, spec];
      const next = resolveSpecifier(file, spec);
      if (next !== null) {
        const hit = visit(next, [...chain, relative(SRC, next)]);
        if (hit !== null) return hit;
      }
    }
    return null;
  };
  return visit(root, [relative(SRC, root)]);
}

const isClientEntry = (file: string): boolean => /^\s*["']use client["']/.test(readFileSync(file, "utf8").slice(0, 200));
const rel = (file: string): string => relative(SRC, file).replaceAll("\\", "/");
const isJudgeFile = (file: string): boolean => rel(file).startsWith("features/judge/") || rel(file).includes("(judge)");

/** Every "use client" file a judge file (server or client) reaches: each starts a browser graph that ships on a judge route. */
function judgeClientEntries(): string[] {
  const seen = new Set<string>();
  const queue = [...ALL].filter(isJudgeFile);
  const entries = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    if (isClientEntry(file)) entries.add(file);
    for (const spec of valueImports(readFileSync(file, "utf8"))) {
      const next = resolveSpecifier(file, spec);
      if (next !== null) queue.push(next);
    }
  }
  return [...entries].sort();
}

const ROOTS = judgeClientEntries();

describe("client bundle graph of the judge routes", () => {
  it("finds client entries to check (the scan is not vacuous)", () => {
    expect(ROOTS.length).toBeGreaterThan(10);
    expect(ROOTS.map(rel)).toContain("features/judge/governance/GovernanceView.tsx");
  });

  it.each(ROOTS.map((file) => [rel(file), file] as const))("%s does not reach zod", (_name, file) => {
    expect(reachesForbidden(file)).toBeNull();
  });

  it("the scanner finds a zod import two hops down (it fails on the leak it guards)", () => {
    const [first, second] = [...ALL];
    if (first === undefined || second === undefined) throw new Error("no source files");
    const spec = `@/${relative(SRC, second).replaceAll("\\", "/").replace(/\.tsx?$/, "")}`;
    const text = (file: string): string => (file === first ? `import { x } from "${spec}";\n` : 'import { z } from "zod";\n');
    expect(reachesForbidden(first, text)).toEqual([relative(SRC, first), relative(SRC, second), "zod"]);
  });

  it("ignores type-only imports (they are erased at build)", () => {
    expect(valueImports('import type { A } from "zod";\nimport { type B } from "zod";\nexport type { C } from "zod";\n')).toEqual([]);
    expect(valueImports('import { z } from "zod";\nconst m = await import("zod");\n')).toEqual(["zod", "zod"]);
  });
});

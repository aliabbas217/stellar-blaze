/** Shared by the import-graph lint tests (not a test file: importing a test file would run its tests twice). */

/** The value specifiers a source file imports (type-only imports and exports are dropped). */
export function valueImports(source: string): string[] {
  const out: string[] = [];
  const staticImport = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^"';]*?)\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(staticImport)) {
    const [, typeOnly, clause, spec] = match;
    if (typeOnly !== undefined || spec === undefined) continue;
    const named = /^\{([^}]*)\}$/.exec((clause ?? "").trim());
    if (named !== null && (named[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "))) continue;
    out.push(spec);
  }
  for (const match of source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) if (match[1] !== undefined) out.push(match[1]);
  for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) if (match[1] !== undefined) out.push(match[1]);
  return out;
}

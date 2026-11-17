// Lints /DESIGN.md with @google/design.md and fails on warnings as well as errors.
//
// The stock CLI (`designmd lint`) exits non-zero only when there are errors
// (@google/design.md 0.4.0, dist/index.js: exitCode = errors > 0), and its WCAG
// contrast rule is severity "warning". A broken contrast pair therefore still
// exits 0. This wrapper uses the same linter through its documented programmatic
// API and treats any warning as a failure. Info findings are allowed.
//
// Usage: node scripts/design-lint.mjs [path-to-DESIGN.md]
import { readFileSync } from "node:fs";
import { lint } from "@google/design.md/linter";

const file = process.argv[2] ?? new URL("../../DESIGN.md", import.meta.url);
const { findings, summary } = lint(readFileSync(file, "utf8"));

console.log(JSON.stringify({ findings, summary }, null, 2));

if (summary.errors > 0 || summary.warnings > 0) {
  console.error(
    `design:lint failed: ${String(summary.errors)} error(s), ${String(summary.warnings)} warning(s). Warnings fail this check on purpose.`,
  );
  process.exit(1);
}

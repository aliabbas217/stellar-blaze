// Writes tests/fixtures/eval/*.synthetic.json from the typed builders in tests/fixtures/eval/synthetic.ts.
// Run from frontend/ after the contract (src/api/schema.d.ts) moves: `node scripts/write-synthetic-eval.mjs`.
// tests/unit/features/judge/synthetic-fixtures.test.ts fails when a committed file differs from the builders.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderSyntheticFiles } from "../tests/fixtures/eval/synthetic.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "eval");
mkdirSync(dir, { recursive: true });
for (const [name, text] of Object.entries(renderSyntheticFiles())) {
  writeFileSync(path.join(dir, `${name}.synthetic.json`), text);
  console.log(`wrote tests/fixtures/eval/${name}.synthetic.json`);
}

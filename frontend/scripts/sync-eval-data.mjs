// Copies the exporter's eval files (B3: `artifacts/eval/`) into the frontend after checking their shape.
//
//   node scripts/sync-eval-data.mjs <path-to-artifacts-eval>          (or SB_EVAL_ARTIFACTS=<path>)
//   --root <dir>                                                       the frontend directory (default: this script's parent)
//
// The source directory holds `2026/` and/or `dev/`, each with policy_scoreboard.json, plan_scoreboard.json and
// demo_day.json (ADR 0034 section 4). Missing files are fine (the 2026 run lands later); a file that is present but
// invalid stops everything: all files are validated first, and nothing is copied unless every present file passes.
//
//   2026/<name>.json  ->  data/eval/2026/<name>.json   and  public/data/eval/2026/<name>.json
//                         (public copy: the proof drawer's "Recount in this browser" fetches it)
//   dev/<name>.json   ->  data/eval/dev/<name>.2025.json   ONLY: development files are never published, and the loader
//                         never reads them in production.
//
// A file's `evaluation_set` must match where it sits (scored_2026 in 2026/, dev_2025 in dev/): a development export
// dropped into 2026/ is refused, never shown as the result.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkEvalShape, EVAL_FILES, EVAL_KINDS } from "../src/features/judge/eval-shape.mjs";

const SETS = [
  { dir: "2026", set: "scored_2026", target: (name) => ["data/eval/2026", `${name}.json`], published: true },
  { dir: "dev", set: "dev_2025", target: (name) => ["data/eval/dev", `${name}.2025.json`], published: false },
];

function parseArgs(argv) {
  const args = { source: process.env.SB_EVAL_ARTIFACTS || "", root: path.join(path.dirname(fileURLToPath(import.meta.url)), "..") };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") args.root = path.resolve(argv[(i += 1)] ?? "");
    else args.source = argv[i];
  }
  return args;
}

function main() {
  const { source, root } = parseArgs(process.argv.slice(2));
  if (source === "") {
    console.error("usage: node scripts/sync-eval-data.mjs <path-to-artifacts-eval>   (or set SB_EVAL_ARTIFACTS)");
    process.exit(1);
  }
  const base = path.resolve(source);

  const plan = [];
  const errors = [];
  for (const { dir, set, target, published } of SETS) {
    for (const kind of EVAL_KINDS) {
      const name = EVAL_FILES[kind].name;
      const from = path.join(base, dir, `${name}.json`);
      if (!existsSync(from)) continue;
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(from, "utf8"));
      } catch {
        errors.push(`${dir}/${name}.json: not valid JSON`);
        continue;
      }
      const problem = checkEvalShape(kind, parsed, set);
      if (problem !== null) {
        errors.push(`${dir}/${name}.json: ${problem}`);
        continue;
      }
      const [targetDir, targetName] = target(name);
      plan.push({ from, to: path.join(root, targetDir, targetName), copyTo: published ? path.join(root, "public", "data", "eval", dir, targetName) : null });
    }
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error("Nothing was copied.");
    process.exit(1);
  }
  if (plan.length === 0) {
    console.error(`no eval file found under ${base} (expected 2026/ and/or dev/ with policy_scoreboard.json, plan_scoreboard.json, demo_day.json)`);
    process.exit(1);
  }

  for (const { from, to, copyTo } of plan) {
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    console.log(`copied ${path.relative(root, to)}`);
    if (copyTo !== null) {
      mkdirSync(path.dirname(copyTo), { recursive: true });
      copyFileSync(from, copyTo);
      console.log(`copied ${path.relative(root, copyTo)}`);
    }
  }
}

main();

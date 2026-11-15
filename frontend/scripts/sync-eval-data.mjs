// Copies the exporter's eval files (B3: `artifacts/eval/`) into the frontend after checking their shape.
//
//   node scripts/sync-eval-data.mjs <path-to-artifacts-eval>          (or SB_EVAL_ARTIFACTS=<path>)
//   node scripts/sync-eval-data.mjs --git <repo> --rev <commit> --go-rev <commit>
//                                                                      the 2026 files straight from git objects (read-only `git show`
//                                                                      and `git log`; nothing is ever written into <repo>)
//   --root <dir>                                                       the frontend directory (default: this script's parent)
//
// Directory mode: the source directory holds `2026/` and/or `dev/`, each with policy_scoreboard.json, plan_scoreboard.json and
// demo_day.json (ADR 0034 section 4). Missing files are fine (the 2026 run lands later); a file that is present but
// invalid stops everything: all files are validated first, and nothing is copied unless every present file passes.
//
//   2026/<name>.json  ->  data/eval/2026/<name>.json   and  public/data/eval/2026/<name>.json
//                         (public copy: the proof drawer's "Recount in this browser" fetches it)
//   dev/<name>.json   ->  data/eval/dev/<name>.2025.json   ONLY: development files are never published, and the loader
//                         never reads them in production.
//
// Git mode: reads `artifacts/eval/2026/{policy_scoreboard,plan_scoreboard,demo_day,run_meta}.json` at --rev (the bytes as committed:
// LF, copied unchanged so the file hashes the proof shows are the run's own), the go-ahead marker `backend/training/2026-go.toml`
// at --go-rev and the 2025 development run's policy file (its H4 outcome is the "prior run"). It writes the three 2026 files as
// above plus `evaluation_record.json` (eval-shape.mjs, `buildEvaluationRecord`): the lock hash from the marker, which is only
// accepted when the marker hashes to `run_meta.go_sha256`, the protocol commit and hash, and the commit that introduced each file.
//
// A file's `evaluation_set` must match where it sits (scored_2026 in 2026/, dev_2025 in dev/): a development export
// dropped into 2026/ is refused, never shown as the result.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvaluationRecord, checkEvalShape, EVAL_FILES, EVAL_KINDS, sha256Hex } from "../src/features/judge/eval-shape.mjs";

const SETS = [
  { dir: "2026", set: "scored_2026", target: (name) => ["data/eval/2026", `${name}.json`], published: true },
  { dir: "dev", set: "dev_2025", target: (name) => ["data/eval/dev", `${name}.2025.json`], published: false },
];

const ARTIFACTS = "artifacts/eval/2026";
const GO_MARKER = "backend/training/2026-go.toml";
const DEV_POLICY = "artifacts/eval/dev/policy_scoreboard.2025.json";

function parseArgs(argv) {
  const args = { source: process.env.SB_EVAL_ARTIFACTS || "", git: "", rev: "", goRev: "", root: path.join(path.dirname(fileURLToPath(import.meta.url)), "..") };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") args.root = path.resolve(argv[(i += 1)] ?? "");
    else if (argv[i] === "--git") args.git = path.resolve(argv[(i += 1)] ?? "");
    else if (argv[i] === "--rev") args.rev = argv[(i += 1)] ?? "";
    else if (argv[i] === "--go-rev") args.goRev = argv[(i += 1)] ?? "";
    else args.source = argv[i];
  }
  return args;
}

/** Read-only git: `show` for the committed bytes, `log` for the commit that last changed a path. Never a write command. */
function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { maxBuffer: 256 * 1024 * 1024 });
}

const gitShow = (repo, rev, file) => git(repo, ["show", `${rev}:${file}`]);
const gitFileCommit = (repo, rev, file) => git(repo, ["log", "-1", "--format=%H", rev, "--", file]).toString("utf8").trim();

/** One validated file of the copy plan: where it goes (and its published copy). Null, with the reason in `errors`, when it is not valid. */
function planFor(root, { dir, set, target, published }, name, bytes, errors, label) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    errors.push(`${label}: not valid JSON`);
    return null;
  }
  const kind = EVAL_KINDS.find((k) => EVAL_FILES[k].name === name);
  const problem = checkEvalShape(kind, parsed, set);
  if (problem !== null) {
    errors.push(`${label}: ${problem}`);
    return null;
  }
  const [targetDir, targetName] = target(name);
  return { bytes, to: path.join(root, targetDir, targetName), copyTo: published ? path.join(root, "public", "data", "eval", dir, targetName) : null };
}

function fromDirectory(base, root, errors) {
  const plan = [];
  for (const entry of SETS) {
    for (const kind of EVAL_KINDS) {
      const name = EVAL_FILES[kind].name;
      const from = path.join(base, entry.dir, `${name}.json`);
      if (!existsSync(from)) continue;
      const planned = planFor(root, entry, name, readFileSync(from), errors, `${entry.dir}/${name}.json`);
      if (planned !== null) plan.push(planned);
    }
  }
  if (plan.length === 0 && errors.length === 0) {
    errors.push(`no eval file found under ${base} (expected 2026/ and/or dev/ with policy_scoreboard.json, plan_scoreboard.json, demo_day.json)`);
  }
  return plan;
}

function fromGit(repo, rev, goRev, root, errors) {
  const plan = [];
  const files = {};
  const [scored] = SETS;
  for (const kind of EVAL_KINDS) {
    const name = EVAL_FILES[kind].name;
    const file = `${ARTIFACTS}/${name}.json`;
    const bytes = gitShow(repo, rev, file);
    const planned = planFor(root, scored, name, bytes, errors, `${rev}:${file}`);
    if (planned === null) continue;
    plan.push(planned);
    files[`${name}.json`] = { commit: gitFileCommit(repo, rev, file), sha256: sha256Hex(bytes) };
  }
  if (errors.length > 0) return plan;
  try {
    const runMeta = JSON.parse(gitShow(repo, rev, `${ARTIFACTS}/run_meta.json`).toString("utf8"));
    const goBytes = gitShow(repo, goRev, GO_MARKER);
    const devFile = JSON.parse(gitShow(repo, rev, DEV_POLICY).toString("utf8"));
    const h4 = (devFile.verdicts ?? []).find((verdict) => verdict.id === "H4");
    if (h4 === undefined || typeof h4.outcome !== "string") throw new Error(`${DEV_POLICY} has no H4 verdict`);
    const record = buildEvaluationRecord({
      runMeta,
      goBytes,
      files,
      prior: { outcome: h4.outcome, commit: gitFileCommit(repo, rev, DEV_POLICY) },
    });
    const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    plan.push({ bytes, to: path.join(root, "data/eval/2026", "evaluation_record.json"), copyTo: path.join(root, "public/data/eval/2026", "evaluation_record.json") });
  } catch (error) {
    errors.push(`evaluation record: ${error instanceof Error ? error.message : String(error)}`);
  }
  return plan;
}

function main() {
  const { source, git: repo, rev, goRev, root } = parseArgs(process.argv.slice(2));
  const errors = [];
  let plan;
  if (repo !== "") {
    if (rev === "" || goRev === "") {
      console.error("usage: node scripts/sync-eval-data.mjs --git <repo> --rev <commit> --go-rev <commit>");
      process.exit(1);
    }
    plan = fromGit(repo, rev, goRev, root, errors);
  } else {
    if (source === "") {
      console.error("usage: node scripts/sync-eval-data.mjs <path-to-artifacts-eval>   (or set SB_EVAL_ARTIFACTS), or --git <repo> --rev <commit> --go-rev <commit>");
      process.exit(1);
    }
    plan = fromDirectory(path.resolve(source), root, errors);
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error("Nothing was copied.");
    process.exit(1);
  }

  for (const { bytes, to, copyTo } of plan) {
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, bytes);
    console.log(`copied ${path.relative(root, to)}`);
    if (copyTo !== null) {
      mkdirSync(path.dirname(copyTo), { recursive: true });
      copyFileSync(to, copyTo);
      console.log(`copied ${path.relative(root, copyTo)}`);
    }
  }
}

main();

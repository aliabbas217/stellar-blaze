// What a scored export must look like before a screen may read it. Plain JavaScript (JSDoc types) on purpose: the
// loader (data.ts) and the two Node scripts (scripts/sync-eval-data.mjs, scripts/build-data-manifest.mjs) share this one
// definition, and a script cannot import TypeScript through "@/". The three kinds are the three exporter files of
// ADR 0034 section 4; the required keys are the `required` lists of the generated components (PolicyScoreboard,
// PlanScoreboard, DemoDay in openapi/stellar-blaze.openapi.json), and tests/unit/features/judge/eval-shape.test.ts fails
// when the contract moves and this list does not.
import { createHash } from "node:crypto";

/** @typedef {"policy" | "plans" | "day"} EvalKind */
/** @typedef {"scored_2026" | "dev_2025"} EvaluationSet */

/** @type {Readonly<Record<EvalKind, { readonly name: string, readonly required: readonly string[] }>>} */
export const EVAL_FILES = {
  policy: {
    name: "policy_scoreboard",
    required: [
      "evaluation_set",
      "station",
      "season_start",
      "season_end",
      "working_hours_utc",
      "n_days",
      "ruleset_id",
      "ruleset_sha256",
      "theta_protect",
      "theta_balanced",
      "margin_w_m2",
      "withdrawal_limits",
      "assumed_crew_size",
      "assumed_crew_label",
      "leads",
      "sensitivity",
      "verdicts",
      "provenance",
    ],
  },
  plans: {
    name: "plan_scoreboard",
    required: [
      "evaluation_set",
      "station",
      "site_id",
      "crew_id",
      "crew_label",
      "headcount",
      "roster",
      "season_start",
      "season_end",
      "n_days",
      "ruleset_id",
      "ruleset_sha256",
      "fixture_sha256",
      "rows",
      "identical_by_construction",
      "verdicts",
      "provenance",
    ],
  },
  day: {
    name: "demo_day",
    required: [
      "evaluation_set",
      "station",
      "date",
      "score",
      "high_hours",
      "high_hours_outside_ban",
      "raw_hits",
      "p3_hits",
      "candidates",
      "runner_up",
      "lead_days",
      "rule",
      "hours",
      "provenance",
    ],
  },
};

/** @type {readonly EvalKind[]} */
export const EVAL_KINDS = ["policy", "plans", "day"];

/**
 * Why a parsed file is not a valid export of this kind and evaluation set, or null when it is. The evaluation set is the
 * contamination guard: a development (2025) file in the held-out 2026 location, or the reverse, is an error and never
 * silently shown or hidden.
 * @param {EvalKind} kind
 * @param {unknown} value
 * @param {EvaluationSet} expectedSet
 * @returns {string | null}
 */
export function checkEvalShape(kind, value, expectedSet) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "it is not a JSON object";
  const record = /** @type {Record<string, unknown>} */ (value);
  const missing = EVAL_FILES[kind].required.filter((key) => !(key in record));
  if (missing.length > 0) return `it lacks ${missing.join(", ")}`;
  if (record["evaluation_set"] !== expectedSet) {
    return `evaluation_set is ${JSON.stringify(record["evaluation_set"])}, this location holds only ${expectedSet}`;
  }
  const provenance = record["provenance"];
  if (typeof provenance !== "object" || provenance === null || Array.isArray(provenance)) {
    return "provenance is not an object";
  }
  return null;
}

/**
 * Lowercase hex SHA-256 of the bytes.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/*
 * The evaluation record: what the held-out 2026 run was locked to, written BY `scripts/sync-eval-data.mjs` from the run's own
 * artifacts (never typed). The three exporter files carry a provenance block but not the pre-registration lock; the lock hash
 * (`lock_sha256`) lives in the go-ahead marker `backend/training/2026-go.toml`, whose own hash IS in the run's `run_meta.json`
 * (`go_sha256`), so the script refuses to write a record whose marker does not hash to that value. The record also names the
 * commit that introduced each result file and the outcome of the 2025 development run's primary hypothesis (the prior run).
 */

/** @type {readonly string[]} */
export const EVALUATION_RECORD_KEYS = [
  "evaluation_set",
  "lock_sha256",
  "go_sha256",
  "protocol_path",
  "protocol_commit",
  "protocol_sha256",
  "model_id",
  "files",
  "prior_run",
];

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;

/**
 * Why a parsed value is not a valid evaluation record, or null when it is.
 * @param {unknown} value
 * @returns {string | null}
 */
export function checkEvaluationRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "it is not a JSON object";
  const record = /** @type {Record<string, unknown>} */ (value);
  const missing = EVALUATION_RECORD_KEYS.filter((key) => !(key in record));
  if (missing.length > 0) return `it lacks ${missing.join(", ")}`;
  if (record["evaluation_set"] !== "scored_2026") return `evaluation_set is ${JSON.stringify(record["evaluation_set"])}, this record describes only scored_2026`;
  for (const key of ["lock_sha256", "go_sha256", "protocol_sha256"]) {
    const hash = record[key];
    if (typeof hash !== "string" || !HEX64.test(hash)) return `${key} is not a SHA-256`;
  }
  const commit = record["protocol_commit"];
  if (typeof commit !== "string" || !HEX40.test(commit)) return "protocol_commit is not a commit id";
  return null;
}

/**
 * The record from the run's own artifacts. Throws (with the reason) when the go-ahead marker is not the one the run hashed
 * (`run_meta.go_sha256`), or when the marker has no `lock_sha256`: a lock hash that cannot be tied to the run is never shown.
 * @param {{ runMeta: Record<string, unknown>, goBytes: Uint8Array, files: Record<string, { commit: string, sha256: string }>, prior: { outcome: string, commit: string } }} input
 * @returns {Record<string, unknown>}
 */
export function buildEvaluationRecord({ runMeta, goBytes, files, prior }) {
  const goSha = sha256Hex(goBytes);
  if (runMeta["go_sha256"] !== goSha) {
    throw new Error(`the go-ahead marker hashes to ${goSha}, not run_meta.go_sha256 ${String(runMeta["go_sha256"])}: it is not the marker the run used`);
  }
  const lock = /^lock_sha256\s*=\s*"([0-9a-f]{64})"\s*$/m.exec(new TextDecoder().decode(goBytes))?.[1];
  if (lock === undefined) throw new Error("the go-ahead marker has no lock_sha256");
  const record = {
    evaluation_set: "scored_2026",
    lock_sha256: lock,
    go_sha256: goSha,
    protocol_path: runMeta["protocol_path"],
    protocol_commit: runMeta["protocol_commit"],
    protocol_sha256: runMeta["protocol_sha256"],
    model_id: runMeta["model_id"],
    files,
    prior_run: { evaluation_set: "dev_2025", h4_outcome: prior.outcome, commit: prior.commit },
  };
  const problem = checkEvaluationRecord(record);
  if (problem !== null) throw new Error(`the evaluation record is not valid: ${problem}`);
  return record;
}

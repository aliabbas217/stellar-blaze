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

import type { components } from "@/api/schema";
import { localMinutesOf, segmentsToRuns, type Run } from "./runs";

/*
 * The validator's answer in the plain shape the screen draws. Imports no zod (the client of /replay/try takes this module;
 * tests/unit/lint/client-bundle-graph.test.ts fails when a client entry reaches it) and re-implements NOTHING: every field is
 * the API's own (rule id, clause, detail, ranges), only the instants are shown in site-local clock time.
 */

type ValidatorResult = components["schemas"]["ValidatorResult"];
type PlanValidateResponse = components["schemas"]["PlanValidateResponse"];

export interface ViolationView {
  /** The API's rule id, an identifier (`P-H3`, `P-H2.daily`): shown in mono, never translated. */
  readonly ruleId: string;
  /** The text of the clause the rule comes from, or "" when the contract carries none: an empty clause is never invented. */
  readonly clause: string;
  /** What the plan does wrong, in the API's own sentence. */
  readonly detail: string;
  /** Where the plan violates the rule, site-local minutes since midnight, in time order. */
  readonly ranges: readonly { readonly fromMin: number; readonly toMin: number }[];
}

export interface ValidatorView {
  readonly passed: boolean;
  readonly checkedRules: readonly string[];
  readonly violations: readonly ViolationView[];
}

export type ForecastStatus = PlanValidateResponse["forecast_status"];

export interface AnswerView {
  readonly validator: ValidatorView;
  readonly forecastStatus: ForecastStatus;
}

export function toValidatorView(result: ValidatorResult): ValidatorView {
  return {
    passed: result.passed,
    checkedRules: result.checked_rules,
    violations: result.violations.map((violation) => ({
      ruleId: violation.rule_id,
      clause: violation.clause,
      detail: violation.detail,
      ranges: violation.ranges.map((range) => ({ fromMin: localMinutesOf(range.starts_at), toMin: localMinutesOf(range.ends_at) })),
    })),
  };
}

export function toAnswerView(response: Pick<PlanValidateResponse, "validator" | "forecast_status">): AnswerView {
  return { validator: toValidatorView(response.validator), forecastStatus: response.forecast_status };
}

/** The recorded result (data/recorded/validator-b0.json): what the validator said when it was recorded, never a fresh check. */
export interface RecordedPlanView extends AnswerView {
  readonly source: "msw-mock" | "api";
  readonly recordedAt: string;
  readonly date: string;
  /** The runs that were checked. */
  readonly runs: readonly Run[];
}

export { segmentsToRuns };

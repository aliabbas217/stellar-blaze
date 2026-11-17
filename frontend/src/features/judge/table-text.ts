import type { PlanId, PolicyId, TableText } from "./adapters";
import { SEASON_BAN } from "./ban";
import type { JudgeT } from "./season-view";

/*
 * The words of the two tables, from the message catalogue, in the shape the adapters take. One place for the scoreboard
 * page and the proof sheet, so a number is named the same on both.
 */

const POLICY_IDS: readonly PolicyId[] = ["P0", "P1", "P2", "P3_protect", "P3_balanced"];
const isPolicyId = (id: string): id is PolicyId => (POLICY_IDS as readonly string[]).includes(id);
const PLAN_ROWS: readonly (PlanId | "merged")[] = ["merged", "rule_raw", "rule_corrected"];
const isPlanRow = (id: string): id is "merged" | "rule_raw" | "rule_corrected" => (PLAN_ROWS as readonly string[]).includes(id);

const UNIT_KEYS = [
  "missed_danger_hours",
  "false_alarm_hours",
  "pod",
  "far",
  "violation_minutes_per_season",
  "high_cycled_share",
  "missed_protection_ticks",
  "rest_minutes_added_vs_naive",
] as const;
const isUnitKey = (metric: string): metric is (typeof UNIT_KEYS)[number] => (UNIT_KEYS as readonly string[]).includes(metric);

export function policyTableText(t: JudgeT): TableText {
  // The midday break's hours are placeholders in the catalogue ("{start} to {end} by law"), filled from the recorded ban window.
  const ban = { start: SEASON_BAN.start, end: SEASON_BAN.end };
  return {
    // The policy codes (P0 to P3) are not printed: the names carry the meaning, and the code and threshold of a row stay in the auditor layer.
    row: (id) => (isPolicyId(id) ? { label: t(`warnings.policies.${id}.label`), sub: t(`warnings.policies.${id}.sub`, ban) } : { label: id, sub: "" }),
    what: (metric, row) => {
      const values = { policy: row };
      if (metric === "missed_danger_hours") return t("warnings.whatMissed", values);
      if (metric === "false_alarm_hours") return t("warnings.whatFalseAlarm", values);
      if (metric === "pod") return t("warnings.whatWarned", values);
      return t("warnings.whatFalseShare", values);
    },
    interval: (lo, hi) => t("table.interval", { lo, hi }),
    baselineNoInterval: t("table.baselineNoInterval"),
    unit: (metric) => (isUnitKey(metric) ? t(`units.${metric}`) : ""),
  };
}

export function planTableText(t: JudgeT): TableText {
  return {
    row: (id) => (isPlanRow(id) ? { label: t(`plans.rows.${id}.label`), sub: t(`plans.rows.${id}.sub`) } : { label: id, sub: "" }),
    what: (metric, row) => {
      const values = { plan: row };
      if (metric === "violation_minutes_per_season") return t("plans.whatViolation", values);
      if (metric === "high_cycled_share") return t("plans.whatCycled", values);
      if (metric === "missed_protection_ticks") return t("plans.whatMissed", values);
      return t("plans.whatRest", values);
    },
    interval: (lo, hi) => t("table.interval", { lo, hi }),
    unit: (metric) => (isUnitKey(metric) ? t(`units.${metric}`) : ""),
  };
}

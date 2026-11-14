import type { PlanId, PolicyId, TableText } from "./adapters";
import type { JudgeT } from "./season-view";

/*
 * The words of the two tables, from the message catalogue, in the shape the adapters take. One place for the scoreboard
 * page and the proof sheet, so a number is named the same on both.
 */

const POLICY_IDS: readonly PolicyId[] = ["P0", "P1", "P2", "P3_protect", "P3_balanced"];
const isPolicyId = (id: string): id is PolicyId => (POLICY_IDS as readonly string[]).includes(id);
const PLAN_ROWS: readonly (PlanId | "merged")[] = ["merged", "rule_raw", "rule_corrected"];
const isPlanRow = (id: string): id is "merged" | "rule_raw" | "rule_corrected" => (PLAN_ROWS as readonly string[]).includes(id);

export function policyTableText(t: JudgeT): TableText {
  return {
    row: (id) => (isPolicyId(id) ? { label: t(`warnings.policies.${id}.label`), sub: t(`warnings.policies.${id}.sub`) } : { label: id, sub: "" }),
    what: (metric, row) => {
      const values = { policy: row };
      if (metric === "missed_danger_hours") return t("warnings.whatMissed", values);
      if (metric === "false_alarm_hours") return t("warnings.whatFalseAlarm", values);
      if (metric === "pod") return t("warnings.whatWarned", values);
      return t("warnings.whatFalseShare", values);
    },
    interval: (lo, hi) => t("table.interval", { lo, hi }),
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
  };
}

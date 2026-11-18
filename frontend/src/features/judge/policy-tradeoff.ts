import type { JudgeFormat, PolicyScoreboard } from "./adapters";
import type { JudgeT } from "./season-view";

/*
 * The honest reading of the Warnings table, as ONE generated paragraph shown under it (data-swap rule 3, review item I1; wording from
 * docs/design/redesign-2026-11-17/01b-content-audit.md section 3.2): what the fixed 32 degC rule trades, how the regulator's zones compare
 * with Stellar Blaze at the protective setting, and whether the balanced setting can be told apart from the regulator's zones. Every number and
 * every "fewer", "more" or "the same number of" is read from the rows of the scored file. Nothing is typed: the comparison word of each clause
 * is computed from the two numbers, so a sentence cannot say "fewer" where the file says "more".
 *
 * Honesty rules, all computed from the file's own 95% intervals (shown to the reader as "likely ranges"):
 *   - a clause whose two intervals overlap says so, so a reader does not take a difference of point estimates for a settled difference;
 *   - the balanced-setting sentence appears only when the intervals overlap on BOTH counts (the reading "cannot be told apart"); when
 *     they do not, it is left out, never softened;
 *   - the sentence about the fixed rule's extremes appears only when the file shows it (the fewest missed hours and the most false alarms
 *     of every row in the file), and says where its ranges overlap ours.
 *
 * Returns null when a row or a number it needs is not in the file (a policy that is not computed has no comparison).
 */

type Row = PolicyScoreboard["leads"][number]["rows"][number];
type Word = "fewer" | "more" | "same";

function word(theirs: number, ours: number): Word {
  return theirs < ours ? "fewer" : theirs > ours ? "more" : "same";
}

function overlap(a: Row["missed_danger_hours"], b: Row["missed_danger_hours"]): boolean {
  if (a.ci === null || b.ci === null) return false;
  return a.ci.lo <= b.ci.hi && b.ci.lo <= a.ci.hi;
}

export function policyTradeoff(policy: PolicyScoreboard, lead: number, format: JudgeFormat, t: JudgeT): string | null {
  const rows = policy.leads.find((l) => l.lead_days === lead)?.rows;
  const by = (id: Row["policy"]): Row | undefined => rows?.find((row) => row.policy === id);
  const [p1, p2, ours, balanced] = [by("P1"), by("P2"), by("P3_protect"), by("P3_balanced")];
  if (rows === undefined || p1 === undefined || p2 === undefined || ours === undefined) return null;
  const computed = [p1, p2, ours].every((row) => !(row.missed_danger_hours.n === 0 && row.missed_danger_hours.ci === null));
  if (!computed) return null;

  const missed = (row: Row): number => row.missed_danger_hours.value;
  const alarms = (row: Row): number => row.false_alarm_hours.value;
  const parts: string[] = [];

  // The fixed 32 degC rule: the fewest missed hours and the most false alarms of every row of the file, or the sentence is left out.
  const others = rows.filter((row) => row !== p1);
  if (others.every((row) => missed(p1) < missed(row)) && others.every((row) => alarms(p1) > alarms(row))) {
    parts.push(t("warnings.tradeoff.extremes", { m: format.one(missed(p1)), f: format.one(alarms(p1)) }));
    const m = overlap(p1.missed_danger_hours, ours.missed_danger_hours);
    const f = overlap(p1.false_alarm_hours, ours.false_alarm_hours);
    if (m || f) parts.push(t(`warnings.tradeoff.extremesOverlap.${m && f ? "both" : m ? "missed" : "falseAlarms"}`));
  }

  // The regulator's zones against our protective setting, each count in the direction the file's numbers give.
  const ov = (a: Row["missed_danger_hours"], b: Row["missed_danger_hours"]): string => (overlap(a, b) ? t("warnings.tradeoff.rangesOverlap") : "");
  const fa = t(`warnings.tradeoff.fa.${word(alarms(p2), alarms(ours))}`, {
    r: format.one(alarms(p2)),
    o: format.one(alarms(ours)),
    ov: ov(p2.false_alarm_hours, ours.false_alarm_hours),
  });
  const miss = t(`warnings.tradeoff.missed.${word(missed(p2), missed(ours))}`, {
    r: format.one(missed(p2)),
    o: format.one(missed(ours)),
    ov: ov(p2.missed_danger_hours, ours.missed_danger_hours),
  });
  parts.push(t("warnings.tradeoff.regulator", { fa, missed: miss }));

  if (balanced !== undefined && overlap(balanced.missed_danger_hours, p2.missed_danger_hours) && overlap(balanced.false_alarm_hours, p2.false_alarm_hours)) {
    parts.push(
      t("warnings.tradeoff.balanced", {
        m1: format.one(missed(balanced)),
        m2: format.one(missed(p2)),
        f1: format.one(alarms(balanced)),
        f2: format.one(alarms(p2)),
      }),
    );
  }
  return parts.join(" ");
}

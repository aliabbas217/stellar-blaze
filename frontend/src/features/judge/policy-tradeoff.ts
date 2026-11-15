import type { JudgeFormat, PolicyScoreboard } from "./adapters";
import type { JudgeT } from "./season-view";

/*
 * The Warnings trade-off, as ONE generated paragraph (data-swap rule 3, review item I1): how Stellar Blaze compares with each other
 * way to warn on danger hours missed and on false-alarm hours, with every number and every "fewer than" or "more than" read from the
 * rows of the scored file. Nothing is typed: the comparison word of each clause is computed from the two numbers, so a sentence
 * cannot say "fewer" where the file says "more". The balanced-threshold sentence appears only when the file's own 95% intervals
 * overlap on both counts (the reading "cannot be told apart"); when they do not, it is left out, never softened.
 *
 * Returns null when a row or a number it needs is not in the file (a policy that is not computed has no comparison).
 */

type Row = PolicyScoreboard["leads"][number]["rows"][number];
type Word = "fewer" | "more" | "same";

function word(ours: number, other: number): Word {
  return ours < other ? "fewer" : ours > other ? "more" : "same";
}

function overlap(a: Row["missed_danger_hours"], b: Row["missed_danger_hours"]): boolean {
  if (a.ci === null || b.ci === null) return false;
  return a.ci.lo <= b.ci.hi && b.ci.lo <= a.ci.hi;
}

export function policyTradeoff(policy: PolicyScoreboard, lead: number, format: JudgeFormat, t: JudgeT): string | null {
  const rows = policy.leads.find((l) => l.lead_days === lead)?.rows;
  const by = (id: Row["policy"]): Row | undefined => rows?.find((row) => row.policy === id);
  const [p0, p1, p2, ours, balanced] = [by("P0"), by("P1"), by("P2"), by("P3_protect"), by("P3_balanced")];
  if (p0 === undefined || p1 === undefined || p2 === undefined || ours === undefined) return null;
  const computed = [p0, p1, p2, ours].every((row) => !(row.missed_danger_hours.n === 0 && row.missed_danger_hours.ci === null));
  if (!computed) return null;

  const cmp = (ours: number, other: number): string => t(`warnings.tradeoff.cmp.${word(ours, other)}`);
  const missed = (row: Row): number => row.missed_danger_hours.value;
  const alarms = (row: Row): number => row.false_alarm_hours.value;
  const parts = [
    t("warnings.tradeoff.missed", {
      theta: policy.theta_protect.toFixed(2),
      a: format.one(missed(ours)),
      c0: cmp(missed(ours), missed(p0)),
      p0: format.one(missed(p0)),
      c1: cmp(missed(ours), missed(p1)),
      p1: format.one(missed(p1)),
      c2: cmp(missed(ours), missed(p2)),
      p2: format.one(missed(p2)),
    }),
    t("warnings.tradeoff.falseAlarm", {
      a: format.one(alarms(ours)),
      c1: cmp(alarms(ours), alarms(p1)),
      p1: format.one(alarms(p1)),
      c2: cmp(alarms(ours), alarms(p2)),
      p2: format.one(alarms(p2)),
    }),
  ];
  if (balanced !== undefined && overlap(balanced.missed_danger_hours, p2.missed_danger_hours) && overlap(balanced.false_alarm_hours, p2.false_alarm_hours)) {
    parts.push(
      t("warnings.tradeoff.balanced", {
        theta: policy.theta_balanced.toFixed(2),
        m1: format.one(missed(balanced)),
        m2: format.one(missed(p2)),
        f1: format.one(alarms(balanced)),
        f2: format.one(alarms(p2)),
      }),
    );
  }
  return parts.join(" ");
}

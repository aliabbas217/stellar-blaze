import type { components } from "@/api/schema";
import type { StoryLine } from "@/components/provenance/proof-story";
import type { JudgeFormat, PlanScoreboard, PolicyScoreboard } from "./adapters";

/*
 * The plain verdicts: one fixed sentence template per hypothesis id, composed from the STRUCTURED fields of the scoring export (the
 * outcome flag, the paired differences and their 95% intervals), never from the verbatim sentence the runner wrote. That sentence
 * (`HypothesisVerdict.text`) is kept exactly as written in the auditor layer ("Exactly as the scoring run wrote it"); this module only
 * decides what a stranger reads first (docs/design/redesign-2026-11-17/01b-content-audit.md section 3, the implementation note).
 *
 * Pure and framework-free, like `buildStory`: it returns catalogue KEYS (under `judge.scoreboard.verdict.plain`) and their values, and the
 * view renders them. The guarantees, pinned by the unit tests on the committed 2026 files and on the submission ledger:
 *   - "met" or "not met" is the file's own `outcome` flag, never a reading of the numbers;
 *   - every number is read from a field and formatted here (the one a reader sees in the table's own format);
 *   - the direction word of a difference ("fewer", "more", "too small to tell apart") comes from the paired 95% interval of that
 *     difference: a difference whose interval includes zero is never called better or worse;
 *   - a verdict whose record is incomplete (a missing comparison, a missing interval, a sign that contradicts the interval, an id with no
 *     template) gets one neutral line and no number: the verbatim sentence stays in the auditor layer;
 *   - nothing says the product "beats" anything, and a verdict that was not met says so.
 */

type Verdict = components["schemas"]["HypothesisVerdict"];
type Comparison = Verdict["comparisons"][number];

export interface PlainVerdict {
  readonly id: string;
  /** The file's own flag, in plain words: `supported` is "met", `negative` is "notMet". Null for a verdict with no template. */
  readonly outcome: "met" | "notMet" | null;
  /** The sentences, in order: catalogue keys relative to `judge.scoreboard.verdict.plain`, with their values. */
  readonly lines: readonly StoryLine[];
}

type Direction = "fewer" | "more" | "unclear";

interface Difference {
  readonly direction: Direction;
  /** The paired difference, as a reader reads it: its size without a sign, and the likely range in the same terms. */
  readonly size: number;
  readonly lo: number;
  readonly hi: number;
  /** The raw signed interval, for an unclear difference (whose range includes zero and says so). */
  readonly signed: { readonly lo: number; readonly hi: number };
}

/**
 * Reads one paired difference. `scale` turns a unit of the file into the unit the reader sees (5-minute ticks into minutes, as the
 * table does). Null when the record is not usable: no interval, or a point estimate on the wrong side of an interval that excludes zero.
 */
function read(comparison: Comparison, scale = 1): Difference | null {
  const { value, ci } = comparison.difference;
  if (ci === null) return null;
  const lo = ci.lo * scale;
  const hi = ci.hi * scale;
  const v = value * scale;
  const signed = { lo, hi };
  if (hi < 0) return v < 0 ? { direction: "fewer", size: -v, lo: -hi, hi: -lo, signed } : null;
  if (lo > 0) return v > 0 ? { direction: "more", size: v, lo, hi, signed } : null;
  return { direction: "unclear", size: Math.abs(v), lo, hi, signed };
}

const find = (verdict: Verdict, subject: string, baseline: string, metric: string): Comparison | undefined =>
  verdict.comparisons.find((c) => c.subject === subject && c.baseline === baseline && c.metric === metric);

const line = (key: string, values?: Record<string, string>): StoryLine => (values === undefined ? { key } : { key, values });

/** The sentence of one difference: the size and the likely range for a clear one, the signed range for one that includes zero. */
function differenceLine(base: string, diff: Difference, show: (v: number) => string): StoryLine {
  const key = `${base}.${diff.direction}`;
  return diff.direction === "unclear"
    ? line(key, { lo: show(diff.signed.lo), hi: show(diff.signed.hi) })
    : line(key, { a: show(diff.size), lo: show(diff.lo), hi: show(diff.hi) });
}

const outcomeOf = (verdict: Verdict): "met" | "notMet" => (verdict.outcome === "supported" ? "met" : "notMet");

function resultLine(verdict: Verdict): StoryLine {
  const met = verdict.outcome === "supported";
  return line(verdict.primary ? (met ? "primaryMet" : "primaryNotMet") : met ? "met" : "notMet");
}

const neutral = (verdict: Verdict): PlainVerdict => ({ id: verdict.id, outcome: null, lines: [line("unknown")] });

/** The checks that compare our protective setting against the midday break alone and against the fixed 32 degC rule (H4, and H4 on the strict forecast). */
function h4(verdict: Verdict, format: JudgeFormat, lead2: boolean): PlainVerdict {
  const missed = find(verdict, "P3_protect", "P0", "missed_danger_hours");
  const alarms = find(verdict, "P3_protect", "P1", "false_alarm_hours");
  const a = missed === undefined ? null : read(missed);
  const b = alarms === undefined ? null : read(alarms);
  if (a === null || b === null) return neutral(verdict);
  return {
    id: verdict.id,
    outcome: outcomeOf(verdict),
    lines: [
      ...(lead2 ? [line("lead2Intro")] : []),
      differenceLine("H4.missed", a, format.one),
      differenceLine("H4.falseAlarms", b, format.one),
      resultLine(verdict),
    ],
  };
}

/**
 * The check against the regulator's own zones (H5). When it was not met, the sentence says why only if the file's own numbers show
 * the reason: the false alarms beyond the 25% the plan allowed (more than a quarter above the regulator's zones, a rule the pre-registration
 * states and the schema documents), or no clear drop in missed hours. If neither shows, no reason is given and none is guessed.
 */
function h5(verdict: Verdict, format: JudgeFormat, regulatorFalseAlarms: number | null): PlainVerdict {
  const missed = find(verdict, "P3_protect", "P2", "missed_danger_hours");
  const alarms = find(verdict, "P3_protect", "P2", "false_alarm_hours");
  const a = missed === undefined ? null : read(missed);
  const b = alarms === undefined ? null : read(alarms);
  if (a === null || b === null) return neutral(verdict);
  const notMet = verdict.outcome !== "supported";
  const reasons: StoryLine[] = [];
  if (notMet) {
    if (b.direction === "more" && regulatorFalseAlarms !== null && b.size > 0.25 * regulatorFalseAlarms) reasons.push(line("H5.reason.falseAlarms"));
    if (a.direction !== "fewer") reasons.push(line("H5.reason.missed"));
  }
  return {
    id: verdict.id,
    outcome: outcomeOf(verdict),
    lines: [differenceLine("H5.missed", a, format.one), differenceLine("H5.falseAlarms", b, format.one), ...reasons, resultLine(verdict), ...(notMet ? [line("noClaim")] : [])],
  };
}

/** The plain verdicts of the Warnings file, in the file's order. An id with no template gets the neutral line. */
export function plainPolicyVerdicts(policy: PolicyScoreboard, format: JudgeFormat): PlainVerdict[] {
  const rows = policy.leads.find((l) => l.lead_days === 1)?.rows;
  const regulatorFalseAlarms = rows?.find((row) => row.policy === "P2")?.false_alarm_hours.value ?? null;
  return policy.verdicts.map((verdict) => {
    if (verdict.id === "H4") return h4(verdict, format, false);
    if (verdict.id === "H4-lead2") return h4(verdict, format, true);
    if (verdict.id === "H5") return h5(verdict, format, regulatorFalseAlarms);
    return neutral(verdict);
  });
}

/** Minutes in one scoring tick (the contract): the table shows minutes, so a verdict about ticks shows minutes too, by the same factor. */
const MINUTES_PER_TICK = 5;

/** The plain verdicts of the Plans file. */
export function plainPlanVerdicts(plans: PlanScoreboard, format: JudgeFormat): PlainVerdict[] {
  return plans.verdicts.map((verdict) => {
    if (verdict.id === "H6") {
      const c = find(verdict, "rule_corrected", "ban_only", "violation_minutes_per_season");
      const d = c === undefined ? null : read(c);
      if (d === null) return neutral(verdict);
      return {
        id: verdict.id,
        outcome: outcomeOf(verdict),
        lines: [differenceLine("H6", d, format.whole), line("H6.crew", { headcount: format.whole(plans.headcount) }), resultLine(verdict)],
      };
    }
    if (verdict.id === "H7") {
      const c = find(verdict, "rule_corrected", "rule_raw", "missed_protection_ticks");
      const d = c === undefined ? null : read(c, MINUTES_PER_TICK);
      if (d === null) return neutral(verdict);
      return { id: verdict.id, outcome: outcomeOf(verdict), lines: [differenceLine("H7", d, format.whole), resultLine(verdict)] };
    }
    return neutral(verdict);
  });
}

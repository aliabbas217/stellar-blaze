import type { components } from "@/api/schema";
import type { ScoreCell, ScoreRow } from "@/components/provenance/ScoreboardTable";
import { proofFromProvenance, type Proof, type ProofAudit } from "@/components/provenance/proof";
import { buildStory, type ProofStory, type Season, type StoryRange } from "@/components/provenance/proof-story";

/*
 * Exporter files to table rows. The only place a `PolicyScoreboard` or a `PlanScoreboard` becomes cells: it formats
 * (Western digits in every locale), builds one proof per number from the file's provenance block, and gives every number
 * a stable claim id for its proof sheet. Words (policy names, "what the number is") come from the caller as `text`, so
 * they live in the message catalogues, not here. The verdict sentence is never composed here.
 */

type Schemas = components["schemas"];
export type PolicyScoreboard = Schemas["PolicyScoreboard"];
export type PlanScoreboard = Schemas["PlanScoreboard"];
export type PolicyId = Schemas["PolicyRow"]["policy"];
export type PlanId = Schemas["PlanRow"]["plan"];
type Metric = Schemas["Metric"];

export interface JudgeFormat {
  /** One decimal: hours, minutes per season. */
  readonly one: (value: number) => string;
  /** No decimals. */
  readonly whole: (value: number) => string;
  /** A share 0 to 1 as a percentage, no decimals: "93%". */
  readonly percent: (value: number) => string;
  /** A share 0 to 1 as a percentage with one decimal: "7.5%". */
  readonly percentOne: (value: number) => string;
}

/** Number formats for `locale`, always Western digits (`-u-nu-latn`): numerals never switch script. */
export function makeFormat(locale: string): JudgeFormat {
  const tag = `${locale}-u-nu-latn`;
  const one = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const whole = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 0 });
  const percentOne = new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 1 });
  return {
    one: (v) => one.format(v),
    whole: (v) => whole.format(v),
    percent: (v) => percent.format(v),
    percentOne: (v) => percentOne.format(v),
  };
}

export interface TableText {
  /** The row name and its one-line description, in the reader's language. */
  readonly row: (id: string) => { readonly label: string; readonly sub: string };
  /** What a number is, for its proof chip: `metric` is a `PolicyMetric` or `PlanMetric` key. */
  readonly what: (metric: string, rowLabel: string) => string;
  readonly interval: (lo: string, hi: string) => string;
  /** Shown instead of an interval on the baseline row whose bootstrap interval is a single point ("baseline, no interval"). */
  readonly baselineNoInterval?: string;
  /** What a metric counts ("hours", "of danger hours were warned"), for the proof sheet. Optional. */
  readonly unit?: (metric: string) => string;
}

export interface AdapterContext {
  /** The path (relative to `data/`) and SHA-256 of the file the page drew. */
  readonly file: { readonly path: string; readonly sha256: string };
  readonly format: JudgeFormat;
  readonly text: TableText;
}

/** The metrics of the Warnings table, in column order. */
export const POLICY_METRICS = ["missed_danger_hours", "false_alarm_hours", "pod", "far"] as const;
export type PolicyMetric = (typeof POLICY_METRICS)[number];

/** The metrics of the Plans table, in column order. */
export const PLAN_METRICS = [
  "violation_minutes_per_season",
  "high_cycled_share",
  "missed_protection_ticks",
  "rest_minutes_added_vs_naive",
] as const;
export type PlanMetric = (typeof PLAN_METRICS)[number];

/** Minutes in one scoring tick: `missed_protection_ticks` counts 5-minute ticks (the contract), the table shows minutes. */
const MINUTES_PER_TICK = 5;

/** The claim-id slug of a policy: P3_protect is "p3" (the headline row), P3_balanced keeps its suffix. */
export function policySlug(policy: PolicyId): string {
  return policy === "P3_protect" ? "p3" : policy.toLowerCase();
}

/** The lead the Warnings headline is scored at (about 24 hours ahead) and the strict sensitivity lead (issued by 18:00 the evening before). */
export type PolicyLead = 1 | 2;

/** Lead 1 keeps the plain id (`policy.p3.pod`); lead 2 is `policy.lead2.p3.pod`, so one number never has two sheets. */
export function policyClaim(policy: PolicyId, metric: string, lead: PolicyLead = 1): string {
  return `policy.${lead === 1 ? "" : "lead2."}${policySlug(policy)}.${metric}`;
}

export function planClaim(plan: PlanId, metric: string): string {
  return `plan.${plan}.${metric}`;
}

interface Shown {
  readonly value: string;
  readonly interval: string | null;
}

function shown(metric: Metric, scale: number, show: (v: number) => string, text: TableText, baseline: boolean): Shown {
  // A baseline that never warns has a degenerate interval (the bootstrap of a constant): it is not a measured uncertainty, so it is
  // not printed as one.
  const point = metric.ci !== null && metric.ci.lo === metric.ci.hi && metric.ci.lo === metric.value;
  return {
    value: show(metric.value * scale),
    interval:
      metric.ci === null ? null : baseline && point && text.baselineNoInterval !== undefined ? text.baselineNoInterval : text.interval(show(metric.ci.lo * scale), show(metric.ci.hi * scale)),
  };
}

/**
 * A metric with no denominator (`n` is 0 and it has no interval: the false-alarm share of a policy that never warns) is NOT
 * computed, whatever `value` says: the file writes 0 there. It is shown as "not computed", never as a zero and never with a proof.
 */
function notComputed(metric: Metric): boolean {
  return metric.n === 0 && metric.ci === null;
}

/**
 * The likely range for the story: the same numbers, scale and formatter as the table cell shows, so the story can never say a different
 * interval. None where the cell shows none (no interval, or a baseline's single point, which is not a measured uncertainty).
 */
function storyRange(metric: Metric, scale: number, show: (v: number) => string, unit: StoryRange["unit"], baseline: boolean): StoryRange | null {
  if (metric.ci === null) return null;
  if (baseline && metric.ci.lo === metric.ci.hi && metric.ci.lo === metric.value) return null;
  return { lo: show(metric.ci.lo * scale), hi: show(metric.ci.hi * scale), unit };
}

/** What a cell needs besides the metric to tell its story: built by the row builder, which holds the file. */
interface CellStory {
  readonly story: (range: StoryRange | null) => ProofStory;
  readonly unit: StoryRange["unit"];
  readonly audit?: ProofAudit;
}

function cell(
  metric: Metric,
  scale: number,
  show: (v: number) => string,
  what: string,
  claim: string,
  provenance: Schemas["Provenance"],
  ctx: AdapterContext,
  metricKey: string,
  baseline: boolean,
  tell: CellStory,
): ScoreCell {
  if (notComputed(metric)) return { value: "", what, proof: null, notComputed: true };
  const { value, interval } = shown(metric, scale, show, ctx.text, baseline);
  const proof: Proof | null = proofFromProvenance(provenance, metric.anchor, what, ctx.file, {
    claim,
    story: tell.story(storyRange(metric, scale, show, tell.unit, baseline)),
    ...(tell.audit === undefined ? {} : { audit: tell.audit }),
  });
  const unit = ctx.text.unit?.(metricKey);
  return { value, ...(unit === undefined ? {} : { unit }), ...(interval === null ? {} : { interval }), what, proof };
}

/**
 * The Warnings rows at forecast lead `lead` (1: about 24 hours ahead, the headline; 2: issued by 18:00 the evening before), in the
 * order of the file: P0, P1, P2, the protective P3 and, only when the file carries it, the balanced P3 (both thetas are shown).
 * Our rows are last and marked.
 */
export function toPolicyRows(sb: PolicyScoreboard, lead: PolicyLead, ctx: AdapterContext): ScoreRow[] {
  const result = sb.leads.find((l) => l.lead_days === lead);
  if (result === undefined) return [];
  const f = ctx.format;
  const season = storySeason(sb);
  return result.rows.map((row) => {
    const { label, sub } = ctx.text.row(row.policy);
    const audit: ProofAudit = { policy: policyAudit(row.policy, sb) };
    const at = (key: PolicyMetric, scale: number, show: (v: number) => string): ScoreCell =>
      cell(row[key], scale, show, ctx.text.what(key, label), policyClaim(row.policy, key, lead), sb.provenance, ctx, key, row.policy === "P0", {
        story: (range) => buildStory("policy", { ...season, policy: row.policy, metric: key, lead, marginWm2: sb.margin_w_m2, range }),
        unit: key === "pod" || key === "far" ? "share" : "hours",
        audit,
      });
    return {
      id: row.policy,
      label,
      sublabel: sub,
      ours: row.policy === "P3_protect" || row.policy === "P3_balanced",
      cells: [at("missed_danger_hours", 1, f.one), at("false_alarm_hours", 1, f.one), at("pod", 1, f.percent), at("far", 1, f.percent)],
    };
  });
}

/**
 * The Plans rows: naive, ban_only, rule_raw, rule_corrected, with the plans named in `identical_by_construction` merged
 * into ONE row (ADR 0057: naive is ban-only on the legal roster, so two rows with the same numbers would read as two
 * results). The merged row takes its numbers from the first plan of the group present in the file.
 */
export function toPlanRows(sb: PlanScoreboard, ctx: AdapterContext): ScoreRow[] {
  const f = ctx.format;
  const merged = new Set<PlanId>(sb.identical_by_construction);
  const rows: ScoreRow[] = [];
  let mergedDone = false;
  for (const row of sb.rows) {
    const isMerged = merged.size > 1 && merged.has(row.plan);
    if (isMerged && mergedDone) continue;
    if (isMerged) mergedDone = true;
    const id = isMerged ? "merged" : row.plan;
    const { label, sub } = isMerged ? ctx.text.row("merged") : knownRow(ctx.text, row.plan, row.label);
    // ban only (and naive, which is ban only on the legal roster) is a baseline by construction: its single-point intervals are not measured
    const baseline = row.plan === "naive" || row.plan === "ban_only";
    const season = storySeason(sb);
    const at = (key: PlanMetric, scale: number, show: (v: number) => string): ScoreCell =>
      cell(row[key], scale, show, ctx.text.what(key, label), planClaim(row.plan, key), sb.provenance, ctx, key, baseline, {
        story: (range) => buildStory("plan", { ...season, plan: isMerged ? "merged" : row.plan, metric: key, headcount: sb.headcount, range }),
        unit: key === "high_cycled_share" ? "share" : "minutes",
      });
    rows.push({
      id,
      label,
      sublabel: sub,
      ours: row.plan === "rule_corrected",
      cells: [
        at("violation_minutes_per_season", 1, f.whole),
        at("high_cycled_share", 1, f.percent),
        at("missed_protection_ticks", MINUTES_PER_TICK, f.whole),
        at("rest_minutes_added_vs_naive", 1, f.whole),
      ],
    });
  }
  return rows;
}

/** A plan that has no message of its own (naive or ban_only shown alone) falls back to the label the file carries. */
function knownRow(text: TableText, plan: PlanId, fileLabel: string): { label: string; sub: string } {
  return plan === "rule_raw" || plan === "rule_corrected" ? text.row(plan) : { label: fileLabel, sub: "" };
}

/** The place and period a scored file covers, for the story (the station code is turned into a name there and never printed). */
export function storySeason(sb: { readonly station: string; readonly season_start: string; readonly season_end: string; readonly n_days: number }): Season {
  return { station: sb.station, seasonStart: sb.season_start, seasonEnd: sb.season_end, nDays: sb.n_days };
}

/** The auditor-only name of a policy and its threshold: the code the scoring run uses and, for our two settings, theta. */
function policyAudit(policy: PolicyId, sb: PolicyScoreboard): NonNullable<ProofAudit["policy"]> {
  if (policy === "P3_protect") return { code: "P3, protective", threshold: `theta ${String(sb.theta_protect)}` };
  if (policy === "P3_balanced") return { code: "P3, balanced", threshold: `theta ${String(sb.theta_balanced)}` };
  return { code: policy };
}

/** The Warnings rows with no numbers, for the pending table: the same four policies in the same order. */
export function pendingPolicyRows(text: TableText): ScoreRow[] {
  return (["P0", "P1", "P2", "P3_protect"] as const).map((id) => {
    const { label, sub } = text.row(id);
    return { id, label, sublabel: sub, ours: id === "P3_protect", cells: [] };
  });
}

/** The Plans rows with no numbers, for the pending table: the merged ban-only row and the two rule plans. */
export function pendingPlanRows(text: TableText): ScoreRow[] {
  return (["merged", "rule_raw", "rule_corrected"] as const).map((id) => {
    const { label, sub } = text.row(id);
    return { id, label, sublabel: sub, ours: id === "rule_corrected", cells: [] };
  });
}

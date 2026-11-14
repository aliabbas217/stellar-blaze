import type { components } from "@/api/schema";
import type { ScoreCell, ScoreRow } from "@/components/provenance/ScoreboardTable";
import { proofFromProvenance, type Proof } from "@/components/provenance/proof";

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

export function policyClaim(policy: PolicyId, metric: string): string {
  return `policy.${policySlug(policy)}.${metric}`;
}

export function planClaim(plan: PlanId, metric: string): string {
  return `plan.${plan}.${metric}`;
}

interface Shown {
  readonly value: string;
  readonly interval: string | null;
}

function shown(metric: Metric, scale: number, show: (v: number) => string, text: TableText): Shown {
  return {
    value: show(metric.value * scale),
    interval: metric.ci === null ? null : text.interval(show(metric.ci.lo * scale), show(metric.ci.hi * scale)),
  };
}

function cell(
  metric: Metric,
  scale: number,
  show: (v: number) => string,
  what: string,
  claim: string,
  provenance: Schemas["Provenance"],
  ctx: AdapterContext,
): ScoreCell {
  const { value, interval } = shown(metric, scale, show, ctx.text);
  const proof: Proof | null = proofFromProvenance(provenance, metric.anchor, what, ctx.file, { claim });
  return { value, ...(interval === null ? {} : { interval }), what, proof };
}

/**
 * The Warnings rows at forecast lead `lead` (1: about 24 hours ahead), in the order of the file: P0, P1, P2, the protective
 * P3 and, only when the file carries it, the balanced P3. Our rows are last and marked.
 */
export function toPolicyRows(sb: PolicyScoreboard, lead: 1, ctx: AdapterContext): ScoreRow[] {
  const result = sb.leads.find((l) => l.lead_days === lead);
  if (result === undefined) return [];
  const f = ctx.format;
  return result.rows.map((row) => {
    const { label, sub } = ctx.text.row(row.policy);
    const at = (key: PolicyMetric, scale: number, show: (v: number) => string): ScoreCell =>
      cell(row[key], scale, show, ctx.text.what(key, label), policyClaim(row.policy, key), sb.provenance, ctx);
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
    const at = (key: PlanMetric, scale: number, show: (v: number) => string): ScoreCell =>
      cell(row[key], scale, show, ctx.text.what(key, label), planClaim(row.plan, key), sb.provenance, ctx);
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

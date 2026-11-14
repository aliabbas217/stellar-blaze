// The synthetic eval files (`*.synthetic.json` next to this file), typed against the generated contract.
//
// What they are for: unit tests and design-gate screenshots of the scoreboard screens before B3 delivers a scored
// file. loadEval() reads them only when NODE_ENV is not "production" AND SB_SHAPE_FIXTURES=1, and the screens draw them
// under a "DEV 2025 / synthetic shape" stamp. They are never a result: every provenance block says SIMULATED with the
// model id "synthetic-shape-fixture", the numbers are made up to have a plausible shape (a protective policy that warns
// more, a ban-only baseline that misses most), and the hypothesis texts say so.
//
// The builders are the source of truth (they fail typecheck when the contract moves); the JSON files are their output.
// tests/unit/features/judge/synthetic-fixtures.test.ts fails when a file differs from what the builders produce.
// Regenerate with: node scripts/write-synthetic-eval.mjs   (from frontend/)
// Node strips the types of this file: no "@/" imports, no enums, relative imports end in ".ts".
import type { components } from "../../../src/api/schema.d.ts";

type Schemas = components["schemas"];
type Metric = Schemas["Metric"];
type PolicyRow = Schemas["PolicyRow"];
type PolicyId = PolicyRow["policy"];

export const SYNTHETIC_MODEL_ID = "synthetic-shape-fixture";

const PROVENANCE: Schemas["Provenance"] = {
  protocol_path: "docs/protocol/synthetic-shape-fixture.md",
  protocol_anchor: "#synthetic-shape-fixture",
  script: "tests.fixtures.eval.synthetic",
  function: "build_synthetic_eval",
  git_sha: "0000000000000000000000000000000000000000",
  data_sha256: "0".repeat(64),
  model_id: SYNTHETIC_MODEL_ID,
  label: "SIMULATED",
  generated_at: "2026-11-14T00:00:00Z",
};

const N_DAYS = 10;
const CREW = 20;
const TRUTH_DANGER_HOURS = 38.5;

function metric(value: number, n: number, anchor: string, spread = 0): Metric {
  return {
    value,
    n,
    anchor,
    ci: spread === 0 ? null : { lo: round(value - spread, 3), hi: round(value + spread, 3) },
  };
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

interface PolicyShape {
  readonly policy: PolicyId;
  readonly label: string;
  readonly rule: string;
  readonly theta: number | null;
  readonly pod: number;
  readonly far: number;
  readonly alerts: number;
}

const POLICIES: readonly PolicyShape[] = [
  { policy: "P0", label: "Ban only", rule: "Warns only inside the midday ban.", theta: null, pod: 0.31, far: 0, alerts: 0 },
  { policy: "P1", label: "Raw WBGT 32", rule: "Warns when the raw forecast WBGT is 32 or more.", theta: null, pod: 0.52, far: 0.38, alerts: 1.2 },
  { policy: "P2", label: "Zones on raw forecast", rule: "Warns when the raw forecast zone is High or Red.", theta: null, pod: 0.71, far: 0.44, alerts: 1.8 },
  { policy: "P3_protect", label: "Stellar Blaze, protective", rule: "Warns when P(High) is at least theta.", theta: 0.15, pod: 0.91, far: 0.47, alerts: 2.6 },
  { policy: "P3_balanced", label: "Stellar Blaze, balanced", rule: "Warns when P(High) is at least theta.", theta: 0.35, pod: 0.8, far: 0.3, alerts: 1.9 },
];

function policyRow(shape: PolicyShape, podShift: number): PolicyRow {
  const pod = Math.min(0.99, Math.max(0.05, shape.pod + podShift));
  const missed = round(TRUTH_DANGER_HOURS * (1 - pod), 2);
  const warned = shape.far < 1 ? (TRUTH_DANGER_HOURS * pod) / (1 - shape.far) : 0;
  const falseAlarm = round(warned * shape.far, 2);
  const csi = round(
    (TRUTH_DANGER_HOURS * pod) / (TRUTH_DANGER_HOURS + falseAlarm),
    3,
  );
  const hours = N_DAYS * 9;
  return {
    policy: shape.policy,
    label: shape.label,
    rule: shape.rule,
    theta: shape.theta,
    missed_danger_hours: metric(missed, hours, "#72-warnings-row", 1.5),
    false_alarm_hours: metric(falseAlarm, hours, "#72-warnings-row", 1.5),
    pod: metric(round(pod, 3), hours, "#72-warnings-row", 0.06),
    far: metric(shape.far, hours, "#72-warnings-row", 0.06),
    csi: metric(csi, hours, "#72-warnings-row", 0.05),
    alerts_per_shift: metric(shape.alerts, N_DAYS, "#72-warnings-row", 0.3),
    missed_danger_crew_hours: metric(round(missed * CREW, 1), hours, "#72-warnings-row", 30),
    false_alarm_crew_hours: metric(round(falseAlarm * CREW, 1), hours, "#72-warnings-row", 30),
  };
}

function policyRows(podShift: number): PolicyRow[] {
  return POLICIES.map((shape) => policyRow(shape, podShift));
}

const LEADS: readonly { lead: number; label: string; shift: number }[] = [
  { lead: 1, label: "about 24 hours ahead", shift: 0 },
  { lead: 2, label: "issued by 18:00 GST the evening before", shift: -0.03 },
  { lead: 3, label: "3 days ahead", shift: -0.06 },
  { lead: 5, label: "5 days ahead", shift: -0.12 },
  { lead: 7, label: "7 days ahead", shift: -0.18 },
];

export function syntheticPolicy(): Schemas["PolicyScoreboard"] {
  const truth = metric(TRUTH_DANGER_HOURS, N_DAYS * 9, "#72-warnings-row");
  return {
    evaluation_set: "dev_2025",
    station: "OMAA",
    season_start: "2025-07-01",
    season_end: "2025-07-10",
    working_hours_utc: "06:00-14:59 UTC (10:00-18:59 GST)",
    n_days: N_DAYS,
    ruleset_id: "ae-heat-2026.1",
    ruleset_sha256: "0".repeat(64),
    theta_protect: 0.15,
    theta_balanced: 0.35,
    margin_w_m2: 7,
    withdrawal_limits: false,
    assumed_crew_size: CREW,
    assumed_crew_label: "assumed crew of 20",
    leads: LEADS.map(({ lead, label, shift }) => ({
      lead_days: lead,
      label,
      headline: lead === 1,
      report_only: lead >= 5,
      truth_danger_hours: truth,
      rows: policyRows(shift),
    })),
    sensitivity: [
      { margin: 7, withdrawal: false, shift: 0 },
      { margin: 7, withdrawal: true, shift: 0.02 },
      { margin: 0, withdrawal: false, shift: -0.02 },
      { margin: 0, withdrawal: true, shift: 0 },
    ].map(({ margin, withdrawal, shift }) => ({
      margin_w_m2: margin,
      withdrawal_limits: withdrawal,
      headline: margin === 7 && !withdrawal,
      lead_days: 1,
      truth_danger_hours: truth,
      rows: policyRows(shift),
    })),
    verdicts: [
      verdict("H4", true, "SYNTHETIC H4: P3 at theta_protect misses fewer danger hours than P1 (shape fixture, not a result).", "P3_protect", "P1", "missed_danger_hours", -9.4, "#72-warnings-row"),
      verdict("H5", false, "SYNTHETIC H5: P3 at theta_balanced has a higher CSI than P2 (shape fixture, not a result).", "P3_balanced", "P2", "csi", 0.08, "#72-warnings-row"),
    ],
    provenance: PROVENANCE,
  };
}

function verdict(
  id: string,
  primary: boolean,
  statement: string,
  subject: string,
  baseline: string,
  metricName: string,
  difference: number,
  anchor: string,
): Schemas["HypothesisVerdict"] {
  return {
    id,
    primary,
    statement,
    outcome: "supported",
    comparisons: [{ metric: metricName, subject, baseline, difference: metric(difference, N_DAYS, anchor, Math.abs(difference) / 4) }],
    text: `${statement} Supported on made-up numbers.`,
  };
}

type PlanId = Schemas["PlanRow"]["plan"];

function planRow(plan: PlanId, label: string, violation: number, cycled: number, missed: number, rest: number): Schemas["PlanRow"] {
  return {
    plan,
    label,
    violation_minutes_per_season: metric(violation, N_DAYS, "#73-plans-row", violation === 0 ? 0 : 20),
    high_cycled_share: metric(cycled, N_DAYS * 108, "#73-plans-row", cycled === 0 ? 0 : 0.05),
    missed_protection_ticks: metric(missed, N_DAYS * 108, "#73-plans-row", missed === 0 ? 0 : 25),
    rest_minutes_added_vs_naive: metric(rest, N_DAYS, "#73-plans-row", rest === 0 ? 0 : 15),
  };
}

export function syntheticPlans(): Schemas["PlanScoreboard"] {
  return {
    evaluation_set: "dev_2025",
    station: "OMAA",
    site_id: "site-demo-mussafah",
    crew_id: "crew-b",
    crew_label: "SIMULATED crew: 20 experienced adults, heavy work",
    headcount: CREW,
    roster: "L1: 06:00-11:00 + 15:00-18:00 GST",
    season_start: "2025-07-01",
    season_end: "2025-07-10",
    n_days: N_DAYS,
    ruleset_id: "ae-heat-2026.1",
    ruleset_sha256: "0".repeat(64),
    fixture_sha256: "0".repeat(64),
    rows: [
      planRow("naive", "Ban only", 240, 0.12, 410, 0),
      planRow("ban_only", "Ban only", 240, 0.12, 410, 0),
      planRow("rule_raw", "Rules on raw forecast", 90, 0.46, 160, 55),
      planRow("rule_corrected", "Rules on corrected forecast", 30, 0.71, 70, 80),
    ],
    identical_by_construction: ["naive", "ban_only"],
    verdicts: [
      verdict("H6", true, "SYNTHETIC H6: the corrected-forecast plan has fewer violation minutes than ban only (shape fixture, not a result).", "rule_corrected", "naive", "violation_minutes_per_season", -210, "#73-plans-row"),
      verdict("H7", false, "SYNTHETIC H7: the corrected-forecast plan misses fewer protection ticks than the raw-forecast plan (shape fixture, not a result).", "rule_corrected", "rule_raw", "missed_protection_ticks", -90, "#73-plans-row"),
    ],
    provenance: PROVENANCE,
  };
}

const HOURS: readonly {
  readonly hour: number;
  readonly weight: number;
  readonly truth: number;
  readonly zone: Schemas["DemoDayHour"]["truth_zone"];
  readonly raw: number;
  readonly rawZone: "low" | "medium" | "high" | "red";
  readonly p: number;
  readonly warned: Schemas["DemoDayHour"]["warned_by"];
}[] = [
  { hour: 6, weight: 1, truth: 27.1, zone: "medium", raw: 26.2, rawZone: "medium", p: 0.08, warned: [] },
  { hour: 7, weight: 1, truth: 28.9, zone: "medium", raw: 27.5, rawZone: "medium", p: 0.19, warned: ["P3_protect"] },
  { hour: 8, weight: 0.5, truth: 30.4, zone: "high", raw: 28.6, rawZone: "medium", p: 0.41, warned: ["P3_protect", "P3_balanced"] },
  { hour: 9, weight: 0, truth: 31.8, zone: "high", raw: 30.1, rawZone: "high", p: 0.62, warned: ["P0", "P2", "P3_protect", "P3_balanced"] },
  { hour: 10, weight: 0, truth: 32.6, zone: "red", raw: 31.0, rawZone: "high", p: 0.74, warned: ["P0", "P1", "P2", "P3_protect", "P3_balanced"] },
  { hour: 11, weight: 1, truth: 32.9, zone: "red", raw: 31.4, rawZone: "high", p: 0.79, warned: ["P1", "P2", "P3_protect", "P3_balanced"] },
  { hour: 12, weight: 1, truth: 32.2, zone: "red", raw: 30.7, rawZone: "high", p: 0.7, warned: ["P2", "P3_protect", "P3_balanced"] },
  { hour: 13, weight: 1, truth: 31.0, zone: "high", raw: 29.8, rawZone: "medium", p: 0.52, warned: ["P3_protect", "P3_balanced"] },
  { hour: 14, weight: 1, truth: 29.3, zone: "medium", raw: 28.3, rawZone: "medium", p: 0.22, warned: ["P3_protect"] },
];

export function syntheticDay(): Schemas["DemoDay"] {
  return {
    evaluation_set: "dev_2025",
    station: "OMAA",
    date: "2025-07-06",
    score: 4.5,
    high_hours: 6.5,
    high_hours_outside_ban: 4.5,
    raw_hits: 3,
    p3_hits: 6,
    candidates: 4,
    runner_up: { date: "2025-07-03", score: 4 },
    lead_days: 1,
    rule: "SYNTHETIC: the day with the most High-zone working hours outside the ban window (shape fixture).",
    hours: HOURS.map((h) => ({
      starts_at: `2025-07-06T${String(h.hour).padStart(2, "0")}:00:00Z`,
      ban_weight: h.weight,
      truth_wbgt_c: h.truth,
      truth_twl_eff_w_m2: round(h.truth * 11.3 - 70, 1),
      truth_zone: h.zone,
      raw_wbgt_c: h.raw,
      raw_twl_eff_w_m2: round(h.raw * 11.3 - 70, 1),
      raw_zone: h.rawZone,
      corrected_wbgt_c: { p05: round(h.truth - 1.6, 1), p50: round(h.truth - 0.4, 1), p95: round(h.truth + 0.9, 1) },
      p_high: h.p,
      protective_twl_w_m2: round(h.truth * 11.3 - 82, 1),
      warned_by: h.warned,
    })),
    provenance: PROVENANCE,
  };
}

/** File name (without the `.synthetic.json` suffix) to the exact text written for it. */
export function renderSyntheticFiles(): Record<string, string> {
  const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  return {
    policy_scoreboard: text(syntheticPolicy()),
    plan_scoreboard: text(syntheticPlans()),
    demo_day: text(syntheticDay()),
  };
}

import { buildStory } from "@/components/provenance/proof-story";
import { proofFromProvenance, type Proof } from "@/components/provenance/proof";
import { storySeason, type JudgeFormat, type PolicyId, type PolicyScoreboard } from "@/features/judge/adapters";
import type { EvalData } from "@/features/judge/data";
import { policyTradeoff } from "@/features/judge/policy-tradeoff";
import { policyTableText } from "@/features/judge/table-text";
import type { JudgeT } from "@/features/judge/season-view";
import { plainPolicyVerdicts } from "@/features/judge/verdict-plain";

/*
 * What the landing's evidence chapter ("Last summer, replayed") shows, read from the scored Warnings file by the loaders the scoreboard uses
 * and by nothing else: the four bars (danger hours that a way of warning did not cover, and its false-alarm hours), the honest sentence about
 * the trade, the two main checks as plain sentences (S3's `plainPolicyVerdicts`, never the verbatim H4 and H5 sentences, which stay in the
 * proof's auditor layer), and the two "Where from" proofs. Pure and framework-free like `buildStory`, so a unit test can assert that every
 * number on the page equals the ledger value it was read from (landing-evidence.test.tsx). No number is typed here.
 *
 * The four bars are the midday break only, the fixed 32 degC rule, the regulator's zones on the raw forecast and Stellar Blaze at the protective setting
 * (the balanced setting is on the scoreboard, not on the landing). They are drawn longest first, an order read from the numbers.
 * Nothing says Stellar Blaze beats anything: the regulator's zones raise fewer false alarms and the fixed rule misses fewer hours, and the
 * sentence under the bars says so.
 */

const BAR_POLICIES = ["P0", "P2", "P3_protect", "P1"] as const satisfies readonly PolicyId[];

export interface EvidenceBar {
  readonly id: PolicyId;
  readonly label: string;
  /** Danger hours not warned about, formatted for the reader (the same format as the scoreboard table). */
  readonly missed: string;
  readonly missedValue: number;
  /** The bar's length as a share of the longest bar, 0 to 1. */
  readonly share: number;
  /** False-alarm hours, formatted. */
  readonly falseAlarms: string;
  readonly falseAlarmsValue: number;
  /** Stellar Blaze's own row: told apart by the accent fill and the weight of its label, never by colour alone. */
  readonly ours: boolean;
}

export interface EvidenceVerdict {
  readonly id: string;
  readonly text: string;
  readonly result: "met" | "notMet" | null;
}

export interface Evidence {
  readonly bars: readonly EvidenceBar[];
  readonly tradeoff: string | null;
  readonly verdicts: readonly EvidenceVerdict[];
  /** "Where from" for the bars (the test: how it was run and what it does not show). Null when the file has no complete record. */
  readonly barsProof: Proof | null;
  /** "Where from" for the checks; the verbatim sentences of the run sit in its auditor layer. */
  readonly verdictProof: Proof | null;
}

/** A catalogue lookup whose keys are built by the verdict templates, so the typed key check cannot see them (the unit tests render them all). */
type Say = (key: string, values?: Readonly<Record<string, string>>) => string;

export function buildEvidence(data: EvalData | null, format: JudgeFormat, ts: JudgeT): Evidence | null {
  const policy: PolicyScoreboard | null = data?.source === "2026" ? data.policy : null;
  const file = data?.files.policy ?? null;
  if (policy === null || file === null) return null;
  const rows = policy.leads.find((lead) => lead.lead_days === 1)?.rows;
  if (rows === undefined) return null;

  const text = policyTableText(ts);
  const picked = BAR_POLICIES.map((id) => rows.find((row) => row.policy === id));
  if (picked.some((row) => row === undefined)) return null;
  const longest = Math.max(...picked.map((row) => row?.missed_danger_hours.value ?? 0));
  const bars: EvidenceBar[] = picked
    .flatMap((row) => (row === undefined ? [] : [row]))
    .map((row) => ({
      id: row.policy,
      label: text.row(row.policy).label,
      missed: format.one(row.missed_danger_hours.value),
      missedValue: row.missed_danger_hours.value,
      share: longest > 0 ? row.missed_danger_hours.value / longest : 0,
      falseAlarms: format.one(row.false_alarm_hours.value),
      falseAlarmsValue: row.false_alarm_hours.value,
      ours: row.policy === "P3_protect",
    }))
    .sort((a, b) => b.missedValue - a.missedValue);

  const say = ts as unknown as Say;
  const verdicts = plainPolicyVerdicts(policy, format)
    .filter((verdict) => verdict.id === "H4" || verdict.id === "H5")
    .map((verdict) => ({ id: verdict.id, text: verdict.lines.map((l) => say(`verdict.plain.${l.key}`, l.values)).join(" "), result: verdict.outcome }));

  return {
    bars,
    tradeoff: policyTradeoff(policy, 1, format, ts),
    verdicts,
    barsProof: proofFromProvenance(policy.provenance, "", ts("evaluation.what"), file, {
      story: buildStory("evaluation", { ...storySeason(policy), amendments: data?.record?.amendments.length ?? null }),
    }),
    verdictProof: proofFromProvenance(policy.provenance, "", ts("verdict.heading"), file, {
      story: buildStory("verdict", storySeason(policy)),
      // The sentences the scoring run wrote, exactly, for the auditor layer.
      audit: { verdicts: policy.verdicts.filter((verdict) => verdict.id === "H4" || verdict.id === "H5").map((verdict) => verdict.text) },
    }),
  };
}

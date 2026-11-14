import { proofFromStaticFile, type Proof, type ProofLabel } from "@/components/provenance/proof";
import type { ScoreRow } from "@/components/provenance/ScoreboardTable";
import type { JudgeFormat } from "./adapters";
import type { SeasonFacts } from "./facts";
import type { RosterFrontier } from "./roster-frontier";

/*
 * Claims: every number the judge screens show with a proof has a stable id, and the proof sheet
 * (`/replay/proof/<claim>`) is addressed by it. A claim is built here from the same data and the same proofs the tables and
 * counters use, so the sheet can never say something the page did not. The ids:
 *   policy.<p0|p1|p2|p3|p3_balanced>.<metric>          a Warnings cell (adapters.ts, `policyClaim`)
 *   plan.<plan>.<metric>                                a Plans cell (`planClaim`)
 *   forecast.<days_over_limit|hours_over_limit|hours_in_break>
 *                                                       the season counts, from the recorded forecast file
 *   frontier.best.ge30.commute_<minutes>, frontier.legalisation.ge30
 *                                                       the roster frontier readouts
 * A claim whose proof is null (no complete provenance) is not a claim: it has no sheet, the same as an unknown id.
 */

export type ClaimKind = "scored" | "forecast" | "analysis";

export interface Claim {
  readonly id: string;
  /** The number in words (names it in the proof chip and heads the sheet). */
  readonly what: string;
  readonly value: string;
  readonly interval?: string;
  readonly kind: ClaimKind;
  readonly proof: Proof;
}

/** Claims from table rows: every cell that has a proof and a claim id. */
export function rowClaims(rows: readonly ScoreRow[]): Claim[] {
  return rows.flatMap((row) =>
    row.cells.flatMap((cell): Claim[] => {
      const id = cell.proof?.claim;
      if (cell.proof === null || id === undefined) return [];
      return [{ id, what: cell.what, value: cell.value, ...(cell.interval === undefined ? {} : { interval: cell.interval }), kind: "scored", proof: cell.proof }];
    }),
  );
}

export interface ForecastClaimText {
  readonly daysOverLimit: string;
  readonly hoursOverLimit: string;
  readonly hoursInBreak: string;
}

export interface ForecastSource {
  readonly file: { readonly path: string; readonly sha256: string };
  /** What the file is (the manifest's source line). */
  readonly protocol: string;
}

export const FORECAST_CLAIMS = {
  days: "forecast.days_over_limit",
  hours: "forecast.hours_over_limit",
  inBan: "forecast.hours_in_break",
} as const;

/** The season counts, from the recorded hourly forecast file (RECORDED: a forecast, never a scored result). */
export function forecastClaims(facts: SeasonFacts, source: ForecastSource, format: JudgeFormat, text: ForecastClaimText): Claim[] {
  const proof = (what: string, claim: string): Proof =>
    proofFromStaticFile(source.file, what, {
      protocol: source.protocol,
      script: "src/features/judge/facts.ts:seasonFacts",
      label: "RECORDED",
      claim,
    });
  return [
    { id: FORECAST_CLAIMS.days, what: text.daysOverLimit, value: format.whole(facts.daysOver), kind: "forecast", proof: proof(text.daysOverLimit, FORECAST_CLAIMS.days) },
    { id: FORECAST_CLAIMS.hours, what: text.hoursOverLimit, value: format.whole(facts.over), kind: "forecast", proof: proof(text.hoursOverLimit, FORECAST_CLAIMS.hours) },
    { id: FORECAST_CLAIMS.inBan, what: text.hoursInBreak, value: format.whole(facts.inBan), kind: "forecast", proof: proof(text.hoursInBreak, FORECAST_CLAIMS.inBan) },
  ];
}

export interface FrontierClaimText {
  readonly best: (minutes: number) => string;
  readonly legal: string;
}

export interface FrontierSource {
  readonly file: { readonly path: string; readonly sha256: string };
  readonly label: ProofLabel;
  readonly protocol: string;
}

export const frontierBestId = (minutes: number): string => `frontier.best.ge30.commute_${String(minutes)}`;
export const FRONTIER_LEGAL_ID = "frontier.legalisation.ge30";

/**
 * The roster frontier readouts, one per commute plus the legalisation gain. The numbers are shares of hours at WBGT 30 or
 * more avoided; only commutes the file has a gate row for are claims.
 */
export function frontierClaims(data: RosterFrontier, source: FrontierSource, format: JudgeFormat, text: FrontierClaimText): Claim[] {
  const script = `${data.generated_by} (${data.label})`;
  const proof = (what: string, claim: string): Proof =>
    proofFromStaticFile(source.file, what, { protocol: source.protocol, script, label: source.label, claim });
  return [
    ...data.frontier_absolute_gate.map(
      (gate): Claim => ({
        id: frontierBestId(gate.commute_min),
        what: text.best(gate.commute_min),
        value: format.percentOne(gate.avoided_vs_legal_default_ge30),
        kind: "analysis",
        proof: proof(text.best(gate.commute_min), frontierBestId(gate.commute_min)),
      }),
    ),
    {
      id: FRONTIER_LEGAL_ID,
      what: text.legal,
      value: format.percentOne(data.legalisation_B0_to_B1_mean.ge30),
      kind: "analysis",
      proof: proof(text.legal, FRONTIER_LEGAL_ID),
    },
  ];
}

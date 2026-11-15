import { proofFromStaticFile, type Proof, type ProofLabel } from "@/components/provenance/proof";
import type { ScoreRow } from "@/components/provenance/ScoreboardTable";
import type { JudgeFormat } from "./adapters";
import type { DayCounter } from "./day-view";
import type { SeasonFacts } from "./facts";
import type { RosterFrontier } from "./roster-frontier";

/*
 * Claims: every number the judge screens show with a proof has a stable id, and the proof sheet
 * (`/replay/proof/<claim>`) is addressed by it. A claim is built here from the same data and the same proofs the tables and
 * counters use, so the sheet can never say something the page did not. The ids:
 *   policy.<p0|p1|p2|p3|p3_balanced>.<metric>          a Warnings cell at lead 1 (adapters.ts, `policyClaim`); policy.lead2.<p>.<metric> at lead 2
 *   day.<high|outside|raw|ours|balanced>                the scored day's counters (day-view.ts)
 *   plan.<plan>.<metric>                                a Plans cell (`planClaim`)
 *   forecast.<days_over_limit|hours_over_limit|hours_in_break>
 *                                                       the season counts, from the recorded forecast file
 *   frontier.best.ge30.commute_<minutes>, frontier.legalisation.ge30
 *                                                       the roster frontier readouts
 * A claim whose proof is null (no complete provenance) is not a claim: it has no sheet, the same as an unknown id.
 */

export type ClaimKind = "scored" | "forecast" | "analysis";

/**
 * Which loader each claim-id family comes from. A claim is missing for one of two reasons: no such number exists (an unknown
 * id) or the file behind it could not be read; the second is told apart by WHICH LOADER failed, never by guessing from the id.
 *   scored    policy.*, plan.*, day.*   the scored exporter files (`loadScored`)
 *   frontier  frontier.*            the roster-frontier file (`loadFrontier`)
 *   forecast  forecast.*            the recorded hourly forecast (`loadHourly`)
 */
export type ClaimLoader = "scored" | "frontier" | "forecast";

const CLAIM_FAMILIES: readonly (readonly [prefix: string, loader: ClaimLoader])[] = [
  ["policy.", "scored"],
  ["day.", "scored"],
  ["plan.", "scored"],
  ["frontier.", "frontier"],
  ["forecast.", "forecast"],
];

/** The loader a claim id belongs to, or null for an id of no known family. */
export function loaderOfClaim(id: string): ClaimLoader | null {
  return CLAIM_FAMILIES.find(([prefix]) => id.startsWith(prefix))?.[1] ?? null;
}

/**
 * Whether the proof page says "the file could not be read" (true) or "no provenance recorded" (false) for an id with no
 * claim: only when the loader that owns the id's family failed. An id of an unknown family is never a read failure.
 */
export function isUnreadableClaim(id: string, failed: readonly ClaimLoader[]): boolean {
  const loader = loaderOfClaim(id);
  return loader !== null && failed.includes(loader);
}

export interface Claim {
  readonly id: string;
  /** The number in words (names it in the proof chip and heads the sheet). */
  readonly what: string;
  readonly value: string;
  /** What the value counts, worded ("hours", "of danger hours were warned"): the number on the sheet is never bare. */
  readonly unit?: string;
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
      return [
        {
          id,
          what: cell.what,
          value: cell.value,
          ...(cell.unit === undefined ? {} : { unit: cell.unit }),
          ...(cell.interval === undefined ? {} : { interval: cell.interval }),
          kind: "scored",
          proof: cell.proof,
        },
      ];
    }),
  );
}

/** The scored day's counters (`day.<high|outside|raw|ours|balanced>`): each with its proof, from the same model the day page draws. */
export function dayClaims(counters: readonly DayCounter[] | null): Claim[] {
  return (counters ?? []).flatMap((counter): Claim[] =>
    counter.proof === null ? [] : [{ id: `day.${counter.id}`, what: counter.label, value: counter.value, unit: counter.unit, kind: "scored", proof: counter.proof }],
  );
}

export interface ForecastClaimText {
  readonly daysOverLimit: string;
  readonly hoursOverLimit: string;
  readonly hoursInBreak: string;
  /** What each count counts (the player's own unit lines), when the caller has them. */
  readonly units?: { readonly days: string; readonly hours: string; readonly inBreak: string };
}

export interface ForecastSource {
  readonly file: { readonly path: string; readonly sha256: string };
  /** What the file is (the manifest's source line). */
  readonly protocol: string;
}

const unit = (value: string | undefined): { readonly unit?: string } => (value === undefined ? {} : { unit: value });

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
    { id: FORECAST_CLAIMS.days, what: text.daysOverLimit, value: format.whole(facts.daysOver), ...unit(text.units?.days), kind: "forecast", proof: proof(text.daysOverLimit, FORECAST_CLAIMS.days) },
    { id: FORECAST_CLAIMS.hours, what: text.hoursOverLimit, value: format.whole(facts.over), ...unit(text.units?.hours), kind: "forecast", proof: proof(text.hoursOverLimit, FORECAST_CLAIMS.hours) },
    { id: FORECAST_CLAIMS.inBan, what: text.hoursInBreak, value: format.whole(facts.inBan), ...unit(text.units?.inBreak), kind: "forecast", proof: proof(text.hoursInBreak, FORECAST_CLAIMS.inBan) },
  ];
}

export interface FrontierClaimText {
  readonly best: (minutes: number) => string;
  readonly legal: string;
  /** The readouts' unit lines (the same words the panel prints under each number). */
  readonly units?: { readonly best: string; readonly legal: string };
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
 * more avoided. A best-claim exists only where the export shows a GAIN on top of the legal default
 * (`avoided_vs_legal_default_ge30 > 0`): a zero is not a claim. Where the gate fails (30 to 90 minutes in the committed file) the
 * zero would read as tested-and-equal, and "with sleep kept at the gate" would be untrue because the legal default itself misses it;
 * where it passes, the panel says "not beaten in N of M folds" in its own sentence, which has no proof page.
 */
export function frontierClaims(data: RosterFrontier, source: FrontierSource, format: JudgeFormat, text: FrontierClaimText): Claim[] {
  const script = `${data.generated_by} (${data.label})`;
  const proof = (what: string, claim: string): Proof =>
    proofFromStaticFile(source.file, what, { protocol: source.protocol, script, label: source.label, claim });
  return [
    ...data.frontier_absolute_gate
      .filter((gate) => gate.avoided_vs_legal_default_ge30 > 0)
      .map(
      (gate): Claim => ({
        id: frontierBestId(gate.commute_min),
        what: text.best(gate.commute_min),
        value: format.percentOne(gate.avoided_vs_legal_default_ge30),
        ...unit(text.units?.best),
        kind: "analysis",
        proof: proof(text.best(gate.commute_min), frontierBestId(gate.commute_min)),
      }),
    ),
    {
      id: FRONTIER_LEGAL_ID,
      what: text.legal,
      value: format.percentOne(data.legalisation_B0_to_B1_mean.ge30),
      ...unit(text.units?.legal),
      kind: "analysis",
      proof: proof(text.legal, FRONTIER_LEGAL_ID),
    },
  ];
}

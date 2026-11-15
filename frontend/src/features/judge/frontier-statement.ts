import type { useTranslations } from "next-intl";
import type { Commute } from "@/components/charts/FrontierChart";
import type { JudgeFormat } from "./adapters";
import type { RosterFrontier } from "./roster-frontier";

/*
 * The frontier's heading sentence and its "no gain" note, derived from the exported analysis at the commute on the slider.
 * Nothing in them is typed by hand: the commute, the sleep gate, the sleep the legal default leaves, the fold counts and every
 * percentage come from `roster_frontier.json`. Three rules keep the sentence honest (F-gov review I6):
 *   - it claims no gain from roster shape: where the export has a gain it is reported as what the analysis finds on top of
 *     the legal default, never as what "the best roster" does; the larger gain in the data is credited to the law;
 *   - `legalisation_B0_to_B1_mean` is a MEAN over the analysis, not this commute's figure, so the sentence says "on average";
 *   - a zero gain is not always "tested and equal": where `b1_passes_sleep_gate` is false the legal default itself misses the
 *     sleep gate at that commute, so the sentence says that (and only that); it never says "no roster shape outruns the heat".
 */

/** The commute the slider starts on (and the server renders for); not written to the URL. */
export const DEFAULT_COMMUTE: Commute = 45;

export type FrontierStatement =
  /** The export has no gate row for this commute: no statement can be made. */
  | { readonly kind: "missing"; readonly commute: number }
  /** The analysis finds a gain on top of the legal default at this commute. */
  | { readonly kind: "gain"; readonly commute: number; readonly gain: number; readonly legal: number; readonly gateHours: number }
  /** No gain on top of the legal default. `gatePasses` is false when the legal default itself is under the sleep gate here. */
  | {
      readonly kind: "no-gain";
      readonly commute: number;
      readonly legal: number;
      readonly gateHours: number;
      readonly sleepHours: number;
      readonly gatePasses: boolean;
      readonly foldsNoChange: number;
      readonly folds: number;
    };

export function frontierStatement(data: RosterFrontier, commute: number): FrontierStatement {
  const row = data.frontier_absolute_gate.find((g) => g.commute_min === commute);
  if (row === undefined) return { kind: "missing", commute };
  const legal = data.legalisation_B0_to_B1_mean.ge30;
  const gateHours = data.assumptions.sleep_gate_h;
  if (row.avoided_vs_legal_default_ge30 > 0) return { kind: "gain", commute, gain: row.avoided_vs_legal_default_ge30, legal, gateHours };
  return {
    kind: "no-gain",
    commute,
    legal,
    gateHours,
    sleepHours: row.b1_sleep_h,
    gatePasses: row.b1_passes_sleep_gate,
    foldsNoChange: row.folds_no_change,
    folds: row.folds,
  };
}

export type FrontierT = ReturnType<typeof useTranslations<"judge.frontier">>;

/** The heading text for a statement, through the `judge.frontier` catalogue (ICU placeholders carry the numbers). */
export function frontierHeading(statement: FrontierStatement, t: FrontierT, format: JudgeFormat, formatHours: (hours: number) => string): string {
  const minutes = String(statement.commute);
  switch (statement.kind) {
    case "missing":
      return t("headingMissing", { minutes });
    case "no-gain":
      return t(statement.gatePasses ? "headingNoGainPasses" : "headingNoGainFails", {
        minutes,
        hours: formatHours(statement.gateHours),
        sleep: formatHours(statement.sleepHours),
        noChange: String(statement.foldsNoChange),
        folds: String(statement.folds),
        legal: format.percentOne(statement.legal),
      });
    case "gain":
      return t("headingGain", {
        minutes,
        hours: formatHours(statement.gateHours),
        gain: format.percentOne(statement.gain),
        legal: format.percentOne(statement.legal),
      });
  }
}

/** The readout's sentence where there is no gain at the commute (same fields, same two cases as the heading). */
export function frontierNoGainNote(statement: Extract<FrontierStatement, { kind: "no-gain" }>, t: FrontierT, formatHours: (hours: number) => string): string {
  return t(statement.gatePasses ? "bestNonePasses" : "bestNoneFails", {
    hours: formatHours(statement.gateHours),
    sleep: formatHours(statement.sleepHours),
    noChange: String(statement.foldsNoChange),
    folds: String(statement.folds),
  });
}

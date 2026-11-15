import type { useTranslations } from "next-intl";
import type { Commute } from "@/components/charts/FrontierChart";
import type { JudgeFormat } from "./adapters";
import type { RosterFrontier } from "./roster-frontier";

/*
 * The frontier's heading sentence, derived from the exported analysis at the commute on the slider. Nothing in it is typed
 * by hand: the commute, the threshold, both baselines and every percentage come from `roster_frontier.json`. Two baselines
 * are in play and they are different moves: `avoided_vs_legal_default_ge30` is a gain ON TOP of the legal default (B1), and
 * `legalisation_B0_to_B1_mean.ge30` is the move FROM common practice (B0) TO the legal default. The sentence says "no roster
 * shape outruns the heat" only where the export shows zero gain over the legal default at that commute; anywhere else it
 * reports the two numbers and claims nothing about roster shape. The gain that exists in the data is credited to the law.
 */

/** The commute the slider starts on (and the server renders for); not written to the URL. */
export const DEFAULT_COMMUTE: Commute = 45;

export type FrontierStatement =
  /** No gain over the legal default at this commute. `beyond` is set when this commute is past every commute with a gain. */
  | { readonly kind: "none"; readonly commute: number; readonly beyond: number | null; readonly legal: number }
  | { readonly kind: "gain"; readonly commute: number; readonly gain: number; readonly legal: number; readonly gateHours: number }
  /** The export has no gate row for this commute: no statement can be made. */
  | { readonly kind: "missing"; readonly commute: number };

export function frontierStatement(data: RosterFrontier, commute: number): FrontierStatement {
  const row = data.frontier_absolute_gate.find((g) => g.commute_min === commute);
  if (row === undefined) return { kind: "missing", commute };
  const legal = data.legalisation_B0_to_B1_mean.ge30;
  if (row.avoided_vs_legal_default_ge30 === 0) {
    const lastGain = Math.max(
      -Infinity,
      ...data.frontier_absolute_gate.filter((g) => g.avoided_vs_legal_default_ge30 > 0).map((g) => g.commute_min),
    );
    return { kind: "none", commute, beyond: Number.isFinite(lastGain) && commute > lastGain ? lastGain : null, legal };
  }
  return { kind: "gain", commute, gain: row.avoided_vs_legal_default_ge30, legal, gateHours: data.assumptions.sleep_gate_h };
}

export type FrontierT = ReturnType<typeof useTranslations<"judge.frontier">>;

/** The heading text for a statement, through the `judge.frontier` catalogue (ICU placeholders carry the numbers). */
export function frontierHeading(statement: FrontierStatement, t: FrontierT, format: JudgeFormat, formatHours: (hours: number) => string): string {
  const minutes = String(statement.commute);
  switch (statement.kind) {
    case "missing":
      return t("headingMissing", { minutes });
    case "none":
      return statement.beyond === null
        ? t("headingNone", { minutes, legal: format.percentOne(statement.legal) })
        : t("headingNoneBeyond", { threshold: String(statement.beyond), legal: format.percentOne(statement.legal) });
    case "gain":
      return t("headingGain", {
        minutes,
        hours: formatHours(statement.gateHours),
        gain: format.percentOne(statement.gain),
        legal: format.percentOne(statement.legal),
      });
  }
}

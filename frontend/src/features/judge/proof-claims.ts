import "server-only";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { makeFormat, toPlanRows, toPolicyRows } from "./adapters";
import { frontierClaims, rowClaims, type Claim } from "./claims";
import { EvalDataError, loadEval, type EvalData, type EvalSource } from "./data";
import { loadHourly } from "./hourly";
import { DATA_MANIFEST } from "./manifest.generated";
import { buildSeasonView } from "./season-view";
import { planTableText, policyTableText } from "./table-text";

/**
 * Every claim the judge screens can show a proof sheet for, built from the same loaders, adapters and proofs the scoreboard
 * uses (so the sheet can never say what the page did not), in the language of the request. Server only: it reads the
 * files. `source` says which tier the scored claims came from (held-out 2026, development, shape fixtures, or none).
 */
export interface LoadedClaims {
  readonly claims: readonly Claim[];
  readonly source: EvalSource;
  /** A scored file exists but could not be read: the scored claims are missing for that reason, not because no such number exists. */
  readonly unreadable: boolean;
}

export async function loadClaims(locale: Locale): Promise<LoadedClaims> {
  const [t, tf] = await Promise.all([
    getTranslations({ locale, namespace: "judge.scoreboard" }),
    getTranslations({ locale, namespace: "judge.frontier" }),
  ]);
  const hourly = await loadHourly();
  const format = makeFormat(locale);
  const formatHours = (hours: number): string => new Intl.NumberFormat(`${locale}-u-nu-latn`, { maximumFractionDigits: 2 }).format(hours);

  let data: EvalData | null = null;
  let unreadable = false;
  try {
    data = await loadEval();
  } catch (error) {
    // Same rule as the scoreboard: a file that cannot be read yields no scored claim; a release build fails instead.
    if (!(error instanceof EvalDataError) || process.env.SB_REQUIRE_SCORED === "1") throw error;
    console.error(`proof: ${error.message}`);
    unreadable = true;
  }

  const claims: Claim[] = [...buildSeasonView({ ...hourly, locale, t }).claims];
  const files = data?.files;
  if (data?.frontier != null && files?.frontier != null) {
    const frontier = DATA_MANIFEST["static/roster_frontier.json"];
    claims.push(
      ...frontierClaims(data.frontier, { file: files.frontier, label: frontier.label, protocol: frontier.source }, format, {
        best: (minutes) => tf("whatBest", { minutes: String(minutes) }),
        legal: tf("whatLegal"),
        units: { best: tf("bestUnit", { hours: formatHours(data.frontier.assumptions.sleep_gate_h) }), legal: tf("legalUnit") },
      }),
    );
  }
  if (data?.policy != null && files?.policy != null) {
    claims.push(...rowClaims(toPolicyRows(data.policy, 1, { file: files.policy, format, text: policyTableText(t) })));
  }
  if (data?.plans != null && files?.plans != null) {
    claims.push(...rowClaims(toPlanRows(data.plans, { file: files.plans, format, text: planTableText(t) })));
  }
  return { claims, source: data?.source ?? "none", unreadable };
}

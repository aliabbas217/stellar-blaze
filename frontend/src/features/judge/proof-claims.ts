import "server-only";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { makeFormat, toPlanRows, toPolicyRows } from "./adapters";
import { frontierClaims, rowClaims, type Claim, type ClaimLoader } from "./claims";
import { loadFrontier, loadScored, type EvalSource, type FrontierData, type LoadEvalOptions, type ScoredData } from "./data";
import { loadHourly, type HourlyData } from "./hourly";
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
  /** The loaders whose file exists but could not be read (or is missing at request time): their claims are absent for that reason, not because no such number exists. */
  readonly unreadable: readonly ClaimLoader[];
}

export interface LoadClaimsOptions extends LoadEvalOptions {
  /** Replaces the loaders (tests). */
  readonly loaders?: {
    readonly scored?: () => Promise<ScoredData>;
    readonly frontier?: () => Promise<FrontierData>;
    readonly hourly?: () => Promise<HourlyData>;
  };
}

/**
 * Runs one loader. A failure is the page's calm read-failure state, never a 500: this page is rendered per request, so a file
 * that disappears or is replaced by a bad one after the build is a case the request must survive. (SB_REQUIRE_SCORED=1
 * makes the BUILD fail through `/replay`, which is prerendered; it cannot fail a request, so it does not apply here.)
 */
async function attempt<T>(name: ClaimLoader, failed: ClaimLoader[], load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`proof: ${name}: ${error instanceof Error ? error.message : "unreadable"}`);
    failed.push(name);
    return null;
  }
}

export async function loadClaims(locale: Locale, options: LoadClaimsOptions = {}): Promise<LoadedClaims> {
  const [t, tf] = await Promise.all([
    getTranslations({ locale, namespace: "judge.scoreboard" }),
    getTranslations({ locale, namespace: "judge.frontier" }),
  ]);
  const failed: ClaimLoader[] = [];
  const [hourly, scored, frontier] = await Promise.all([
    attempt("forecast", failed, options.loaders?.hourly ?? (() => loadHourly(options.dataRoot))),
    attempt("scored", failed, options.loaders?.scored ?? (() => loadScored(options))),
    attempt("frontier", failed, options.loaders?.frontier ?? (() => loadFrontier(options))),
  ]);
  const format = makeFormat(locale);
  const formatHours = (hours: number): string => new Intl.NumberFormat(`${locale}-u-nu-latn`, { maximumFractionDigits: 2 }).format(hours);

  const claims: Claim[] = hourly === null ? [] : [...buildSeasonView({ ...hourly, locale, t }).claims];
  if (frontier?.frontier != null && frontier.file != null) {
    const info = DATA_MANIFEST["static/roster_frontier.json"];
    const data = frontier.frontier;
    claims.push(
      ...frontierClaims(data, { file: frontier.file, label: info.label, protocol: info.source }, format, {
        best: (minutes) => tf("whatBest", { minutes: String(minutes) }),
        legal: tf("whatLegal"),
        units: { best: tf("bestUnit", { hours: formatHours(data.assumptions.sleep_gate_h) }), legal: tf("legalUnit") },
      }),
    );
  }
  const files = scored?.files;
  if (scored?.policy != null && files?.policy != null) {
    claims.push(...rowClaims(toPolicyRows(scored.policy, 1, { file: files.policy, format, text: policyTableText(t) })));
  }
  if (scored?.plans != null && files?.plans != null) {
    claims.push(...rowClaims(toPlanRows(scored.plans, { file: files.plans, format, text: planTableText(t) })));
  }
  return { claims, source: scored?.source ?? "none", unreadable: failed };
}

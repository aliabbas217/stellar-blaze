import { useLocale, useTranslations } from "next-intl";
import { SeasonPlayer } from "@/components/charts/SeasonPlayer";
import { ScoreboardTable, type ScoreRow } from "@/components/provenance/ScoreboardTable";
import { Verdict } from "@/components/provenance/Verdict";
import { proofFromProvenance } from "@/components/provenance/proof";
import { StoryNav } from "@/components/shell/StoryNav";
import { Banner } from "@/components/states/Banner";
import { EmptyState } from "@/components/states/EmptyState";
import { PendingBanner } from "@/components/states/PendingBanner";
import { makeFormat, pendingPlanRows, pendingPolicyRows, toPlanRows, toPolicyRows } from "./adapters";
import { EvalSourceStamp } from "./EvalSourceStamp";
import { FrontierSection } from "./FrontierSection";
import { FORECAST_CLAIMS } from "./claims";
import type { EvalData } from "./data";
import type { HourlyData } from "./hourly";
import { buildSeasonView } from "./season-view";
import { planTableText, policyTableText } from "./table-text";

/**
 * The season scoreboard (`/replay`): the hero ribbon with its player and tally, the outcome sentence, Warnings, Plans and
 * the roster frontier, then the story footer. A server component over build-time JSON: nothing here fetches, so the page reads
 * the same with the API stopped. The scoreboard states are decided here from what the loader found:
 *   ideal    both scored files: tables with numbers, each with its proof;
 *   empty    no scored file: `###` under one banner per table, no proof, a link to read how a number is proved;
 *   partial  Warnings but no Plans file: a notice in place of the Plans table;
 *   error    a file that exists but cannot be read (`failed`): the static season above and a plain message;
 * and the `DEV 2025` stamp whenever the numbers are not the held-out 2026 run. Loading is the route's `loading.tsx`.
 */

export interface ScoreboardViewProps {
  /** What the loader found. Null when it threw (`failed`). */
  readonly data: EvalData | null;
  readonly failed?: boolean;
  readonly hourly: HourlyData;
  /** The manifest's label for the frontier file and what the file is, for the proofs of its readouts. */
  readonly frontierSource: { readonly label: "REAL weather + assumed crew"; readonly protocol: string };
}

export function ScoreboardView({ data, failed = false, hourly, frontierSource }: ScoreboardViewProps) {
  const t = useTranslations("judge.scoreboard");
  const locale = useLocale();
  const format = makeFormat(locale);
  const season = buildSeasonView({ ...hourly, locale, t });
  const policy = data?.policy ?? null;
  const plans = data?.plans ?? null;

  const policyText = policyTableText(t);
  const planText = planTableText(t);

  const policyColumns = [
    { key: "missed_danger_hours", heading: t("warnings.columns.missed") },
    { key: "false_alarm_hours", heading: t("warnings.columns.falseAlarm") },
    { key: "pod", heading: t("warnings.columns.warned") },
    { key: "far", heading: t("warnings.columns.falseShare") },
  ];
  const planColumns = [
    { key: "violation_minutes_per_season", heading: t("plans.columns.violation") },
    { key: "high_cycled_share", heading: t("plans.columns.cycled") },
    { key: "missed_protection_ticks", heading: t("plans.columns.missed") },
    { key: "rest_minutes_added_vs_naive", heading: t("plans.columns.rest") },
  ];

  const files = data?.files;
  const policyRows: ScoreRow[] =
    policy !== null && files?.policy != null ? toPolicyRows(policy, 1, { file: files.policy, format, text: policyText }) : pendingPolicyRows(policyText);
  const planRows: ScoreRow[] =
    plans !== null && files?.plans != null ? toPlanRows(plans, { file: files.plans, format, text: planText }) : pendingPlanRows(planText);

  // The outcome sentence is the file's own (`HypothesisVerdict.text` of the primary hypothesis); never composed here.
  const primary = policy?.verdicts.find((verdict) => verdict.primary) ?? null;
  const verdictProof =
    primary !== null && policy !== null && files?.policy != null
      ? proofFromProvenance(policy.provenance, "", t("verdict.heading"), files.policy)
      : null;

  const noScoredFile = policy === null && plans === null;
  // The held-out claim describes the 2026 run (or the protocol before it has run); beside a dev or shape-fixture stamp it would read
  // as a claim about numbers that are not the held-out result.
  const source = data?.source ?? "none";
  const heldOut = source === "2026" || source === "none";
  const crew = policy?.assumed_crew_size;

  return (
    <main id="main-content" className="mx-auto flex w-full max-w-(--content-max) flex-col gap-10 px-4 py-6 sm:px-6 sm:py-8">
      <a
        href="#warnings"
        className="sr-only rounded-sign bg-ink px-4 py-3 text-base font-medium text-ground focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50"
      >
        {t("skip")}
      </a>

      <header className="flex flex-col gap-3">
        <h1 className="font-display text-3xl leading-solid font-normal tracking-display sm:text-4xl">{t("title")}</h1>
        <p className="max-w-(--measure) text-lg text-ink-2">{t("lede", { from: season.firstDay, to: season.lastDay })}</p>
        <p className="text-sm text-ink-3">
          {t("facts")}
          {heldOut ? ` · ${t("factsHeldOut")}` : ""}
        </p>
        <EvalSourceStamp source={source} />
      </header>

      <SeasonPlayer ribbon={season.ribbon} tally={season.tally} proofs={season.proofs} limitC={season.ribbon.limitC} />

      {failed ? (
        <EmptyState title={t("error.title")} reason={t("error.reason")} primary={{ label: t("error.primary"), href: "/replay" }} />
      ) : (
        <>
          <Verdict sentence={primary?.text ?? null} proof={verdictProof} stamp={<EvalSourceStamp source={source} />} />

          {noScoredFile ? (
            <EmptyState
              title={t("empty.title")}
              reason={t("empty.reason")}
              primary={{ label: t("empty.primary"), href: `/replay/proof/${FORECAST_CLAIMS.hours}` }}
            />
          ) : null}

          <section id="warnings" aria-labelledby="warnings-heading" className="flex scroll-mt-4 flex-col gap-4">
            <h2 id="warnings-heading" className="font-display text-2xl font-medium">
              {t("warnings.heading")}
            </h2>
            <EvalSourceStamp source={source} />
            <p className="max-w-(--measure) text-base text-ink-2">{t("warnings.sub")}</p>
            {policy === null ? <PendingBanner what={t("warnings.pending")} /> : null}
            <ScoreboardTable
              caption={t("warnings.caption")}
              rowHeading={t("warnings.columns.policy")}
              columns={policyColumns}
              rows={policyRows}
              pending={policy === null}
            />
            <p className="max-w-(--measure) text-sm text-ink-3">{t("warnings.defs")}</p>
          </section>

          <section id="plans" aria-labelledby="plans-heading" className="flex scroll-mt-4 flex-col gap-4">
            <h2 id="plans-heading" className="font-display text-2xl font-medium">
              {t("plans.heading")}
            </h2>
            <EvalSourceStamp source={source} />
            <p className="max-w-(--measure) text-base text-ink-2">{t("plans.sub")}</p>
            {plans === null && policy !== null ? (
              <Banner>
                <p>
                  <strong className="font-medium text-ink">{t("partial.title")}</strong> {t("partial.reason")}
                </p>
              </Banner>
            ) : (
              <>
                {plans === null ? <PendingBanner what={t("plans.pending")} /> : null}
                {plans === null ? null : (
                  <p className="max-w-(--measure) text-sm text-ink-3">
                    {plans.crew_label} · <bdi>{t("plans.roster", { roster: plans.roster })}</bdi>
                  </p>
                )}
                <ScoreboardTable
                  caption={t("plans.caption")}
                  rowHeading={t("plans.columns.plan")}
                  columns={planColumns}
                  rows={planRows}
                  pending={plans === null}
                />
                <p className="max-w-(--measure) text-sm text-ink-3">{t("plans.defs")}</p>
              </>
            )}
          </section>

          <FrontierSection
            frontier={
              data?.frontier != null && files?.frontier != null
                ? { data: data.frontier, source: { file: files.frontier, ...frontierSource } }
                : null
            }
          />
        </>
      )}

      <ul className="flex flex-wrap gap-x-6 gap-y-2 border-t border-hair pt-4 text-sm text-ink-3" data-limits="">
        <li>{t("limits.station")}</li>
        {crew === undefined ? null : <li>{t("limits.crew", { size: format.whole(crew) })}</li>}
        <li>{t("limits.truth")}</li>
        <li>{t("limits.twl")}</li>
      </ul>

      <StoryNav current="scoreboard" />
    </main>
  );
}

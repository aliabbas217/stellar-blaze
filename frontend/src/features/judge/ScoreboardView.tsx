import { useTranslations } from "next-intl";
import { SeasonPlayer } from "@/components/charts/SeasonPlayer";
import { ScoreboardTable, type ScoreRow } from "@/components/provenance/ScoreboardTable";
import { ProofChip } from "@/components/provenance/ProofChip";
import { Verdict } from "@/components/provenance/Verdict";
import { proofFromProvenance } from "@/components/provenance/proof";
import { buildStory } from "@/components/provenance/proof-story";
import { StoryNav } from "@/components/shell/StoryNav";
import { Banner } from "@/components/states/Banner";
import { EmptyState } from "@/components/states/EmptyState";
import { PendingBanner } from "@/components/states/PendingBanner";
import { makeFormat, pendingPlanRows, pendingPolicyRows, storySeason, toPlanRows, toPolicyRows } from "./adapters";
import { EvalSourceStamp } from "./EvalSourceStamp";
import { FrontierSection } from "./FrontierSection";
import { FORECAST_CLAIMS } from "./claims";
import { VerdictList } from "./VerdictList";
import type { EvalData } from "./data";
import type { HourlyData } from "./hourly";
import { buildSeasonView } from "./season-view";
import { policyTradeoff } from "./policy-tradeoff";
import { planTableText, policyTableText } from "./table-text";
import { CLAIMS_LOCALE } from "@/i18n/claims-english";

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
  const locale = CLAIMS_LOCALE;
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
  // The strict sensitivity (forecast issued by 18:00 the evening before): the same policies at lead 2, when the file has it.
  const lead2Rows: ScoreRow[] =
    policy !== null && files?.policy != null ? toPolicyRows(policy, 2, { file: files.policy, format, text: policyText }) : [];
  const planRows: ScoreRow[] =
    plans !== null && files?.plans != null ? toPlanRows(plans, { file: files.plans, format, text: planText }) : pendingPlanRows(planText);

  // The outcome sentence is the file's own (`HypothesisVerdict.text` of the primary hypothesis); never composed here.
  const primary = policy?.verdicts.find((verdict) => verdict.primary) ?? null;
  const verdictProof =
    primary !== null && policy !== null && files?.policy != null
      ? proofFromProvenance(policy.provenance, "", t("verdict.heading"), files.policy, {
          story: buildStory("verdict", storySeason(policy)),
          audit: { verdicts: [primary.text] },
        })
      : null;

  const policyProof =
    policy !== null && files?.policy != null
      ? proofFromProvenance(policy.provenance, "", t("verdict.other"), files.policy, {
          story: buildStory("verdict", storySeason(policy)),
          audit: { verdicts: policy.verdicts.filter((verdict) => !verdict.primary).map((verdict) => verdict.text) },
        })
      : null;
  const plansProof =
    plans !== null && files?.plans != null
      ? proofFromProvenance(plans.provenance, "", t("verdict.plansHeading"), files.plans, {
          story: buildStory("verdict", storySeason(plans)),
          audit: { verdicts: plans.verdicts.map((verdict) => verdict.text) },
        })
      : null;
  const lead1Verdicts = (policy?.verdicts ?? []).filter((verdict) => !verdict.primary && verdict.id !== "H4-lead2");
  const lead2Verdicts = (policy?.verdicts ?? []).filter((verdict) => verdict.id === "H4-lead2");
  const planVerdicts = plans?.verdicts ?? [];
  // The prior run: H4 on the 2025 development run, from the evaluation record (written by script). Never "robust", never "consistently".
  const prior = data?.record?.prior_run.h4_outcome ?? null;
  const priorCaption =
    primary === null || prior === null
      ? null
      : [primary.outcome === "supported" ? t("verdict.priorNow") : null, prior === "supported" ? t("verdict.priorSupported") : t("verdict.priorNotSupported")]
          .filter((part) => part !== null)
          .join(" ");

  // The plans card: the violation cut and the rest cost together, every number from the file (never typed).
  const planByName = (name: string) => plans?.rows.find((row) => row.plan === name);
  const baseline = planByName("ban_only") ?? planByName("naive");
  const corrected = planByName("rule_corrected");
  const raw = planByName("rule_raw");
  const tradeoff =
    plans !== null && baseline !== undefined && corrected !== undefined && raw !== undefined
      ? t("plans.tradeoff", {
          days: format.whole(plans.n_days),
          from: format.whole(baseline.violation_minutes_per_season.value),
          to: format.whole(corrected.violation_minutes_per_season.value),
          rest: format.whole(corrected.rest_minutes_added_vs_naive.value),
          restRaw: format.whole(raw.rest_minutes_added_vs_naive.value),
        })
      : null;

  // The held-out run's own label and lock, through the proof chip (the drawer shows the lock hash and the protocol commit).
  const evaluationProof =
    data?.source === "2026" && data.record !== null && policy !== null && files?.policy != null
      ? proofFromProvenance(policy.provenance, "", t("evaluation.what"), files.policy, {
          story: buildStory("evaluation", { ...storySeason(policy), amendments: data.record.amendments.length }),
        })
      : null;

  // The truth-based figure: the station's own danger hours (value and interval read from the Warnings file), with its definition.
  const truthMetric = policy?.leads.find((lead) => lead.lead_days === 1)?.truth_danger_hours ?? null;
  const truth =
    policy !== null && truthMetric !== null && truthMetric.ci !== null
      ? t("warnings.truth", {
          value: format.one(truthMetric.value),
          lo: format.one(truthMetric.ci.lo),
          hi: format.one(truthMetric.ci.hi),
          hours: policy.working_hours_utc,
          margin: format.whole(policy.margin_w_m2),
        })
      : null;
  const truthProof =
    policy !== null && truthMetric !== null && files?.policy != null
      ? proofFromProvenance(policy.provenance, truthMetric.anchor, t("warnings.truthWhat"), files.policy, {
          story: buildStory("truth", {
            ...storySeason(policy),
            marginWm2: policy.margin_w_m2,
            range: truthMetric.ci === null ? null : { lo: format.one(truthMetric.ci.lo), hi: format.one(truthMetric.ci.hi), unit: "hours" },
          }),
        })
      : null;

  // The trade-off paragraph: every number and every "fewer" or "more" from the Warnings rows (policy-tradeoff.ts).
  const warningsTradeoff = policy === null ? null : policyTradeoff(policy, 1, format, t);
  const lead2Tradeoff = policy === null ? null : policyTradeoff(policy, 2, format, t);

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
        {evaluationProof === null ? null : (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-2" data-evaluation="">
            <span>{t("evaluation.line")}</span>
            <ProofChip proof={evaluationProof} />
          </p>
        )}
      </header>

      <p className="max-w-(--measure) text-sm text-ink-2" data-season-caption="">
        {t("season.caption")}
      </p>
      <SeasonPlayer ribbon={season.ribbon} tally={season.tally} proofs={season.proofs} limitC={season.ribbon.limitC} />

      {failed ? (
        <EmptyState title={t("error.title")} reason={t("error.reason")} primary={{ label: t("error.primary"), href: "/replay" }} />
      ) : (
        <>
          <Verdict sentence={primary?.text ?? null} proof={verdictProof} stamp={<EvalSourceStamp source={source} />} caption={priorCaption} />

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
            {truth === null ? null : (
              <p className="flex max-w-(--measure) flex-wrap items-center gap-x-3 gap-y-2 text-base text-ink" data-truth-danger="">
                <span>{truth}</span>
                {truthProof === null ? null : <ProofChip proof={truthProof} />}
              </p>
            )}
            {warningsTradeoff === null ? null : (
              <p className="max-w-(--measure) text-base text-ink" data-warnings-tradeoff="">
                {warningsTradeoff}
              </p>
            )}
            {policy === null ? <PendingBanner what={t("warnings.pending")} /> : null}
            <ScoreboardTable
              caption={t("warnings.caption")}
              rowHeading={t("warnings.columns.policy")}
              columns={policyColumns}
              rows={policyRows}
              pending={policy === null}
            />
            <VerdictList heading={t("verdict.other")} items={lead1Verdicts} proof={policyProof} what={t("verdict.other")} />
            <p className="max-w-(--measure) text-sm text-ink-3">{t("warnings.defs")}</p>

            {lead2Rows.length === 0 ? null : (
              <div className="flex flex-col gap-4 border-t border-hair pt-6" data-lead="2">
                <h3 className="text-lg font-semibold text-ink">{t("warnings.lead2.heading")}</h3>
                <p className="max-w-(--measure) text-base text-ink-2">{t("warnings.lead2.sub")}</p>
                {lead2Tradeoff === null ? null : (
                  <p className="max-w-(--measure) text-base text-ink" data-warnings-tradeoff="2">
                    {lead2Tradeoff}
                  </p>
                )}
                <ScoreboardTable caption={t("warnings.lead2.caption")} rowHeading={t("warnings.columns.policy")} columns={policyColumns} rows={lead2Rows} />
                <VerdictList heading={t("verdict.lead2")} items={lead2Verdicts} proof={policyProof} what={t("verdict.lead2")} />
              </div>
            )}
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
                {tradeoff === null ? null : (
                  <p className="max-w-(--measure) text-lg text-ink" data-plans-tradeoff="">
                    {tradeoff}
                  </p>
                )}
                <ScoreboardTable
                  caption={t("plans.caption")}
                  rowHeading={t("plans.columns.plan")}
                  columns={planColumns}
                  rows={planRows}
                  pending={plans === null}
                />
                <VerdictList heading={t("verdict.plansHeading")} items={planVerdicts} proof={plansProof} what={t("verdict.plansHeading")} />
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
        <li>{t("limits.simulated")}</li>
        {crew === undefined ? null : <li>{t("limits.crew", { size: format.whole(crew) })}</li>}
        <li>{t("limits.truth")}</li>
        <li>{t("limits.twl")}</li>
      </ul>

      <StoryNav current="scoreboard" />
    </main>
  );
}

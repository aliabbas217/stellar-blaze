import { useLocale, useTranslations } from "next-intl";
import { dayFormat } from "@/components/charts/day-format";
import { SeasonRibbon } from "@/components/charts/SeasonRibbon";
import { ProofChip } from "@/components/provenance/ProofChip";
import { ScoreboardTable } from "@/components/provenance/ScoreboardTable";
import { Counter } from "@/components/provenance/Counter";
import { proofFromProvenance, proofFromStaticFile } from "@/components/provenance/proof";
import { FieldLink } from "@/components/shell/FieldLink";
import { StoryNav } from "@/components/shell/StoryNav";
import { ACTION_PRIMARY, ACTION_SECONDARY } from "@/components/states/actions";
import { makeFormat, toPolicyRows } from "@/features/judge/adapters";
import { SEASON_BAN, banStateFor } from "@/features/judge/ban";
import type { EvalData } from "@/features/judge/data";
import { EvalSourceStamp } from "@/features/judge/EvalSourceStamp";
import { cumulativeTally, WORK_HOURS } from "@/features/judge/facts";
import type { HourlyData } from "@/features/judge/hourly";
import { buildSeasonView } from "@/features/judge/season-view";
import { policyTradeoff } from "@/features/judge/policy-tradeoff";
import { policyTableText } from "@/features/judge/table-text";
import { VerdictList } from "@/features/judge/VerdictList";
import { HEAVY_WORK_LIMIT_WBGT_C } from "@/features/judge/limit";
import { readingAt } from "./field-data";
import type { FieldHeroData } from "./field-server";
import { FieldGate } from "./FieldGate";
import { FieldPoster, type FieldPanelProps } from "./FieldPoster";
import { HeatCalendar } from "./HeatCalendar";
import { LandingHeader } from "./LandingHeader";

/*
 * The landing page body: the hero (the field, over the copy), chapter 1 "The problem" and chapter 2 "The scoreboard", and the
 * story footer. A server component over build-time files: nothing here fetches, and every number on it is read from a
 * committed file by the code that is imported here (never typed): the season counts from the recorded hourly forecast, the
 * danger hours and the table from the scored Warnings file, the field's readout from the recorded forecast grid.
 *
 * Claim rules this page keeps (architect, 2026-11-15): the season counts say "recorded raw forecast, before correction" and are
 * never hours that were over a limit; the hook is the station's own danger-hour count with its definition and proof; the table is
 * the scoreboard's own rows (all four ways to warn, baselines labelled, both thetas) and the verdict sentences are the run's,
 * verbatim, the favourable one and the one that is not supported side by side. No win claims, no probabilities.
 */

export interface LandingViewProps {
  readonly field: FieldHeroData;
  readonly hourly: HourlyData;
  /** What the scored-file loader found; null when it failed or there is none. */
  readonly data: EvalData | null;
  readonly dir: "ltr" | "rtl";
}

const clock = (hhmm: string): number => {
  const [h, m] = hhmm.split(":");
  return Number(h) + Number(m) / 60;
};

export function LandingView({ field, hourly, data, dir }: LandingViewProps) {
  const t = useTranslations("judge.landing");
  const ts = useTranslations("judge.scoreboard");
  const locale = useLocale();
  const format = makeFormat(locale);
  const f = dayFormat(locale);
  const season = buildSeasonView({ ...hourly, locale, t: ts });
  const { facts } = season;
  const limit = String(HEAVY_WORK_LIMIT_WBGT_C);

  // ---- the field of the hero ----
  const day = field.grid.day;
  const dayLabel = `${f.withWeekday(day)} ${day.slice(0, 4)}`;
  const panel: FieldPanelProps = {
    day,
    dayLabel,
    omaa: field.omaa,
    peakHour: field.peakHour,
    ban: banStateFor(SEASON_BAN, day, locale),
    // The file's own words are the proof's protocol and script (it says plainly that this day is an illustration, not the scored day).
    proof: proofFromStaticFile(field.file, t("field.proofWhat", { day: dayLabel }), {
      protocol: field.grid.why,
      script: field.grid.physics,
      label: "RECORDED",
    }),
    highestOfSeason: field.highestOfSeason,
    dir,
  };
  const reading = readingAt(field.grid, field.omaa, field.peakHour);

  // ---- the scored file: the hook, the evaluation line, the mini table, the verdicts (2026 held-out run only) ----
  const policy = data?.source === "2026" ? data.policy : null;
  const file = data?.files.policy ?? null;
  const scored = policy !== null && file !== null;
  const truthMetric = scored ? (policy.leads.find((lead) => lead.lead_days === 1)?.truth_danger_hours ?? null) : null;
  const hook =
    scored && truthMetric?.ci != null
      ? {
          value: format.one(truthMetric.value),
          interval: t("hook.interval", { lo: format.one(truthMetric.ci.lo), hi: format.one(truthMetric.ci.hi) }),
          definition: t("hook.definition", { hours: policy.working_hours_utc, margin: format.whole(policy.margin_w_m2) }),
          proof: proofFromProvenance(policy.provenance, truthMetric.anchor, ts("warnings.truthWhat"), file),
        }
      : null;
  const evaluationProof = scored && data?.record != null ? proofFromProvenance(policy.provenance, "", ts("evaluation.what"), file) : null;
  const text = policyTableText(ts);
  const miniRows = scored
    ? toPolicyRows(policy, 1, { file, format, text }).map((row) => ({ ...row, cells: row.cells.slice(0, 2) }))
    : [];
  const miniColumns = [
    { key: "missed_danger_hours", heading: ts("warnings.columns.missed") },
    { key: "false_alarm_hours", heading: ts("warnings.columns.falseAlarm") },
  ];
  const tradeoff = scored ? policyTradeoff(policy, 1, format, ts) : null;
  const verdictProof = scored ? proofFromProvenance(policy.provenance, "", ts("verdict.heading"), file) : null;
  const verdicts = scored ? policy.verdicts.filter((verdict) => verdict.primary || verdict.id === "H5") : [];

  // ---- chapter 1: the heat calendar and its month table (counts from the same functions as the scoreboard) ----
  const { series } = hourly;
  const tally = cumulativeTally(series, SEASON_BAN, HEAVY_WORK_LIMIT_WBGT_C);
  const months = new Map<string, { first: number; last: number }>();
  series.days.forEach((d, i) => {
    const key = d.slice(0, 7);
    const m = months.get(key);
    if (m === undefined) months.set(key, { first: i, last: i });
    else m.last = i;
  });
  const monthRows = [...months.values()].map(({ first, last }) => {
    let n = 0;
    let over = 0;
    for (let i = first; i <= last; i++) {
      over += facts.perDay[i] ?? 0;
      for (let h = WORK_HOURS.from; h < WORK_HOURS.to; h++) if (series.wbgt_c_by_local_hour[i]?.[h] != null) n++;
    }
    const inBan = (tally[last]?.inBan ?? 0) - (first === 0 ? 0 : (tally[first - 1]?.inBan ?? 0));
    return {
      key: series.days[first] ?? "",
      period: t("problem.period", { from: f.dayMonth(series.days[first] ?? ""), to: f.dayMonth(series.days[last] ?? "") }),
      n,
      over,
      inBan,
    };
  });
  const hourLabel = (h: number): string => `${String(h).padStart(2, "0")}:00`;
  const banFrom = clock(SEASON_BAN.start);
  const banTo = clock(SEASON_BAN.end);

  const counter = "border-t border-edge pt-2";

  return (
    <>
      <FieldLink
        href="/replay"
        className="sr-only rounded-sign bg-ink px-4 py-3 text-base font-medium text-ground focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50"
      >
        {t("skip")}
      </FieldLink>

      <LandingHeader />

      <main id="main-content" className="flex flex-col">
        <section
          aria-labelledby="landing-title"
          data-landing-hero=""
          className="relative border-b border-hair max-[899px]:flex max-[899px]:flex-col min-[900px]:h-[calc(100svh-3.5rem)] min-[900px]:max-h-240 min-[900px]:min-h-164 min-[900px]:overflow-hidden"
        >
          <div className="relative z-10 grid content-start gap-5 px-4 pt-6 max-[899px]:order-1 min-[900px]:absolute min-[900px]:start-10 min-[900px]:top-[clamp(1.5rem,6vh,4rem)] min-[900px]:max-w-136 min-[900px]:px-0 min-[900px]:pt-0">
            <p className="text-sm text-ink-3">{t("kicker")}</p>
            <h1
              id="landing-title"
              className="font-display text-4xl leading-(--sign-leading-word) font-normal tracking-display min-[900px]:text-5xl"
            >
              {t("title")}
            </h1>
            <p className="max-w-[44ch] text-lg text-ink-2 max-[899px]:hidden">{t("lede")}</p>
            <div className="flex flex-wrap gap-3 max-[899px]:flex-col">
              <FieldLink href="/replay" data-primary="" className={`${ACTION_PRIMARY} min-h-12 text-lg`}>
                {t("primary")}
              </FieldLink>
              <FieldLink href="#problem" className={`${ACTION_SECONDARY} min-h-12 text-lg`}>
                {t("secondary")}
              </FieldLink>
            </div>
            {hook === null ? null : (
              <div className="grid gap-1 border-t border-edge pt-4 max-[899px]:hidden" data-hook="">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <strong className="font-display text-4xl leading-solid font-normal tracking-display tabular-nums text-ink">{hook.value}</strong>
                  <span className="text-base text-ink-2">{t("hook.label")}</span>
                  <ProofChip proof={hook.proof} />
                </div>
                <p className="text-sm text-ink-3 tabular-nums">{hook.interval}</p>
                <p className="max-w-[52ch] text-sm text-ink-3">{hook.definition}</p>
              </div>
            )}
          </div>
          <FieldGate panel={panel}>
            <FieldPoster panel={panel} grid={field.grid} reading={reading} />
          </FieldGate>
        </section>

        <section aria-label={t("hook.heading")} className="mx-auto hidden w-full max-w-(--content-max) gap-4 px-4 pt-8 max-[899px]:grid" data-hook-phone="">
          <p className="text-base text-ink-2">
            {t("lede")} {t("ledeProof")}
          </p>
          {hook === null ? null : (
            <div className="grid gap-1 border-t border-edge pt-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <strong className="font-display text-4xl leading-solid font-normal tracking-display tabular-nums text-ink">{hook.value}</strong>
                <span className="text-base text-ink-2">{t("hook.label")}</span>
                <ProofChip proof={hook.proof} />
              </div>
              <p className="text-sm text-ink-3 tabular-nums">{hook.interval}</p>
              <p className="max-w-[52ch] text-sm text-ink-3">{hook.definition}</p>
            </div>
          )}
        </section>

        <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-24 px-4 pt-16 pb-12 sm:px-6 min-[900px]:px-10">
          <section id="problem" aria-labelledby="problem-title" className="grid scroll-mt-4 gap-6 min-[900px]:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] min-[900px]:gap-12">
            <div className="grid content-start gap-4 min-[900px]:sticky min-[900px]:top-6">
              <p className="text-sm text-ink-3">{t("problem.eyebrow")}</p>
              <h2 id="problem-title" className="font-display text-3xl leading-(--sign-leading-word) font-normal tracking-display">
                {t("problem.heading")}
              </h2>
              <p className="max-w-[46ch] text-base text-ink-2">
                {t("problem.body1", {
                  from: f.dayMonth(series.days[facts.ban?.fromIndex ?? 0] ?? ""),
                  to: f.dayMonth(series.days[facts.ban?.toIndex ?? 0] ?? ""),
                  start: SEASON_BAN.start,
                  end: SEASON_BAN.end,
                })}
              </p>
              <p className="max-w-[46ch] text-base text-ink-2">{t("problem.body2")}</p>
            </div>
            <div className="grid min-w-0 content-start gap-6">
              <p className="text-sm text-ink-2" data-season-caption="">
                {ts("season.caption")}
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-problem-counts="">
                <div className={counter} data-count="hours">
                  <Counter
                    size="numeral"
                    proof={season.proofs.hours}
                    value={format.whole(facts.over)}
                    unit={ts("tally.hours")}
                    interval={t("problem.ofHours", { total: format.whole(facts.n) })}
                  />
                </div>
                <div className={counter} data-count="inBan">
                  <Counter size="numeral" proof={season.proofs.inBan} value={format.whole(facts.inBan)} unit={ts("tally.inBreak")} />
                </div>
                <div className={counter} data-count="days">
                  <Counter
                    size="numeral"
                    proof={season.proofs.days}
                    value={format.whole(facts.daysOver)}
                    unit={ts("tally.days", { limit })}
                    interval={ts("tally.daysOf", { total: format.whole(series.days.length) })}
                  />
                </div>
              </div>
              <HeatCalendar
                rows={series.wbgt_c_by_local_hour}
                from={WORK_HOURS.from}
                to={WORK_HOURS.to}
                limitC={HEAVY_WORK_LIMIT_WBGT_C}
                ban={facts.ban}
                banHours={{ from: banFrom, to: banTo }}
                ticks={season.ribbon.ticks}
                hourTicks={[6, 9, 12, 15, 18].map((hour) => ({ hour, label: hourLabel(hour) }))}
                labels={{
                  aria: t("problem.calendarAria", {
                    start: hourLabel(WORK_HOURS.from),
                    end: hourLabel(WORK_HOURS.to),
                    days: format.whole(series.days.length),
                    from: season.firstDay,
                    to: season.lastDay,
                    over: format.whole(facts.over),
                    n: format.whole(facts.n),
                    limit,
                  }),
                  slot: t("problem.legendSlot"),
                }}
              />
              <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-3">
                <span>{t("problem.legendSlot")}</span>
                <span>{t("problem.legendHot", { limit })}</span>
                <span>{t("problem.legendCool")}</span>
              </p>
              <details className="text-sm text-ink-2" data-calendar-table="">
                <summary className="min-h-(--target) cursor-pointer py-3 text-base text-ink">{t("problem.tableToggle")}</summary>
                <table className="w-full border-collapse text-start tabular-nums">
                  <caption className="sr-only">{t("problem.tableCaption")}</caption>
                  <thead>
                    <tr className="border-b border-edge text-ink-3">
                      <th scope="col" className="px-3 py-2 text-start font-medium">{t("problem.columns.period")}</th>
                      <th scope="col" className="px-3 py-2 text-end font-medium">{t("problem.columns.hours")}</th>
                      <th scope="col" className="px-3 py-2 text-end font-medium">{t("problem.columns.over")}</th>
                      <th scope="col" className="px-3 py-2 text-end font-medium">{t("problem.columns.inBreak")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthRows.map((row) => (
                      <tr key={row.key} className="border-b border-hair">
                        <th scope="row" className="px-3 py-2 text-start font-normal text-ink">{row.period}</th>
                        <td className="px-3 py-2 text-end">{format.whole(row.n)}</td>
                        <td className="px-3 py-2 text-end">{format.whole(row.over)}</td>
                        <td className="px-3 py-2 text-end">{format.whole(row.inBan)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          </section>

          <section id="scoreboard" aria-labelledby="season-title" className="grid scroll-mt-4 gap-6 min-[900px]:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] min-[900px]:gap-12">
            <div className="grid content-start gap-4 min-[900px]:sticky min-[900px]:top-6">
              <p className="text-sm text-ink-3">{t("season.eyebrow")}</p>
              <h2 id="season-title" className="font-display text-3xl leading-(--sign-leading-word) font-normal tracking-display">
                {t("season.heading")}
              </h2>
              <p className="max-w-[46ch] text-base text-ink-2">{t("season.body")}</p>
              {evaluationProof === null ? null : (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-2" data-evaluation="">
                  <span>{ts("evaluation.line")}</span>
                  <ProofChip proof={evaluationProof} />
                </p>
              )}
              <FieldLink href="/replay" className={`${ACTION_PRIMARY} justify-self-start`}>
                {t("season.open")}
              </FieldLink>
            </div>
            <div className="grid min-w-0 content-start gap-6">
              <SeasonRibbon {...season.ribbon} compact />
              {data?.source !== "2026" && data !== null ? <EvalSourceStamp source={data.source} /> : null}
              {miniRows.length === 0 ? null : (
                <ScoreboardTable caption={t("season.caption")} rowHeading={ts("warnings.columns.policy")} columns={miniColumns} rows={miniRows} />
              )}
              {tradeoff === null ? null : (
                <p className="max-w-(--measure) text-base text-ink" data-warnings-tradeoff="">
                  {tradeoff}
                </p>
              )}
              <VerdictList heading={ts("verdict.heading")} items={verdicts} proof={verdictProof} what={ts("verdict.heading")} />
            </div>
          </section>

          <StoryNav current="problem" />

          <section aria-labelledby="apps-title" className="grid gap-3 border-t border-hair pt-6 text-ink-2">
            <h2 id="apps-title" className="text-base font-semibold text-ink">
              {t("apps.heading")}
            </h2>
            <AppLinks />
            <p className="text-sm text-ink-3">{t("apps.note")}</p>
          </section>
        </div>
      </main>
    </>
  );
}

function AppLinks() {
  const t = useTranslations("shell.roleChooser");
  const link = ACTION_SECONDARY;
  return (
    <ul className="flex flex-wrap gap-3">
      <li>
        <FieldLink href="/worker" className={link}>
          {t("worker.title")}
        </FieldLink>
      </li>
      <li>
        <FieldLink href="/supervisor" className={link}>
          {t("supervisor.title")}
        </FieldLink>
      </li>
    </ul>
  );
}

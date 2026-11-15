import { useLocale, useTranslations } from "next-intl";
import { DayChart } from "@/components/charts/DayChart";
import { Counter } from "@/components/provenance/Counter";
import { ProofChip } from "@/components/provenance/ProofChip";
import { StoryNav } from "@/components/shell/StoryNav";
import { EmptyState } from "@/components/states/EmptyState";
import { PendingBanner } from "@/components/states/PendingBanner";
import { SEASON_BAN } from "./ban";
import { EvalSourceStamp } from "./EvalSourceStamp";
import type { EvalData } from "./data";
import { AXIS, buildDay, type DayModel } from "./day-view";
import type { HourlyData } from "./hourly";
import { HEAVY_WORK_LIMIT_WBGT_C } from "./limit";

/**
 * One day, hour by hour (`/replay/day`): the hero chart (raw forecast as made about 24 hours ahead, our 5 to 95 % range,
 * station truth, the limit, the midday break), one primary action ("Read the day rule", the proof drawer), the table
 * alternative, and the four counters of the scored day. A server component over build-time JSON: it reads no API.
 *
 * The scored day is whatever `demo_day.json` says. Until the scoring run writes it the page draws the raw hourly series of
 * the replay day and says so: no "ours", no truth, and `###` under one banner instead of the four counters. A file that
 * exists but cannot be read (`failed`) shows the chart of the recorded forecast and a plain message, never a guess.
 */

export interface DayViewProps {
  /** What the loader found. Null when it threw (`failed`). */
  readonly data: EvalData | null;
  readonly failed?: boolean;
  readonly hourly: HourlyData;
}

export function DayView({ data, failed = false, hourly }: DayViewProps) {
  const t = useTranslations("judge.day");
  const locale = useLocale();
  const day = failed ? null : (data?.day ?? null);
  const dayFile = failed ? null : (data?.files.day ?? null);
  const model = buildDay({ day, dayFile, hourly, locale, t });
  const source = day === null ? "none" : (data?.source ?? "none");

  // A day file that could not be read draws NO day and says nothing about a scoring run: after the run, "until the scoring run
  // picks the day" would be false, and the recorded hottest day shown as the day would read as the scored one.
  if (failed) {
    return (
      <main id="main-content" className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8" data-day-shown="failed">
        <header className="flex flex-col gap-3">
          <h1 className="max-w-(--measure) font-display text-3xl leading-solid font-normal tracking-display sm:text-4xl">{t("titlePending")}</h1>
        </header>
        <EmptyState title={t("error.title")} reason={t("error.reason")} primary={{ label: t("error.primary"), href: "/replay/day" }} />
        <StoryNav current="day" />
      </main>
    );
  }

  return (
    <main id="main-content" className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-3">
        <h1 className="max-w-(--measure) font-display text-3xl leading-solid font-normal tracking-display sm:text-4xl">{model.scored ? t("title") : t("titlePending")}</h1>
        <p className="max-w-(--measure) text-lg text-ink-2">{t("lede")}</p>
        <EvalSourceStamp source={source} />
      </header>

      <section aria-labelledby="day-heat-heading" className="flex flex-col gap-4">
        <h2 id="day-heat-heading" className="sr-only">
          {t("heatHeading")}
        </h2>
        <div data-hero="" className="flex flex-col gap-3">
          <p className="text-base text-ink-2" data-day-shown={model.scored ? "scored" : "pending"}>
            {model.scored ? t("dayShown", { date: model.dateLabel }) : t("dayShownPending", { date: model.dateLabel })}
          </p>
          <DayChart
            raw={model.raw}
            {...(model.ours === undefined ? {} : { ours: model.ours })}
            {...(model.truth === undefined ? {} : { truth: model.truth })}
            ban={model.ban}
            from={AXIS.from}
            to={AXIS.to}
            limitC={HEAVY_WORK_LIMIT_WBGT_C}
            labels={model.labels}
          />
          {model.scored ? null : <p className="text-sm text-ink-3">{t("laterSeries")}</p>}
        </div>

        <RuleBox model={model} />
        <HoursTable model={model} />
      </section>

      <Counters model={model} />

      <StoryNav current="day" />
    </main>
  );
}

function RuleBox({ model }: { readonly model: DayModel }) {
  const t = useTranslations("judge.day");
  return (
    <div className="flex flex-col gap-3 rounded-sign border border-hair bg-panel p-4" data-rule="">
      <h3 className="text-base font-semibold text-ink">{t("rule.heading")}</h3>
      <p className="max-w-(--measure) text-sm text-ink-2">{t("rule.body")}</p>
      {model.scored ? (
        model.candidates === null ? null : (
          <p className="text-sm text-ink-3">
            {t("rule.candidates", { count: String(model.candidates) })}
            {model.runnerUp === null ? "" : ` ${t("rule.runnerUp", { date: model.runnerUp })}`}
          </p>
        )
      ) : (
        <p className="max-w-(--measure) text-sm text-ink-3">{t("rule.pending")}</p>
      )}
      <div>
        <ProofChip proof={model.ruleProof} variant="primary" label={t("rule.read")} />
      </div>
    </div>
  );
}

function HoursTable({ model }: { readonly model: DayModel }) {
  const t = useTranslations("judge.day.table");
  const pending = (
    <span role="img" aria-label={t("notScored")} className="text-ink-3">
      ###
    </span>
  );
  return (
    <details className="rounded-sign border border-hair" data-day-table="">
      <summary className="min-h-(--target) cursor-pointer px-4 py-3 text-base font-medium text-ink">{t("toggle")}</summary>
      <div
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll container must be reachable by keyboard (WCAG 2.1.1)
        tabIndex={0}
        role="region"
        aria-label={t("caption")}
        className="overflow-x-auto border-t border-hair"
      >
        <table className="w-full min-w-max text-sm tabular-nums">
          <caption className="sr-only">{t("caption")}</caption>
          <thead>
            <tr className="text-start text-ink-3">
              <th scope="col" className="px-3 py-2 text-start font-normal">
                {t("hour")}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-normal">
                {t("raw")}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-normal">
                {t("ours")}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-normal">
                {t("truth")}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-normal">
                {t("inBreak")}
              </th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <tr key={row.hour} className="border-t border-hair">
                <th scope="row" className="px-3 py-2 text-start font-normal text-ink">
                  {String(row.hour).padStart(2, "0")}:00
                </th>
                <td className="px-3 py-2 text-end text-ink">{row.raw ?? ""}</td>
                <td className="px-3 py-2 text-end text-ink">{model.ours === undefined ? pending : (row.ours ?? "")}</td>
                <td className="px-3 py-2 text-end text-ink">{model.truth === undefined ? pending : (row.truth ?? "")}</td>
                <td className="px-3 py-2 text-start text-ink-2">{row.inBreak ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Counters({ model }: { readonly model: DayModel }) {
  const t = useTranslations("judge.day.counters");
  const notScored = useTranslations("judge.day.table")("notScored");
  const pendingLabels = [t("high"), t("outside", { start: SEASON_BAN.start, end: SEASON_BAN.end }), t("p1"), t("raw"), t("ours"), t("balanced")];
  return (
    <section aria-labelledby="day-counters-heading" className="flex flex-col gap-4" data-day-counters="">
      <h2 id="day-counters-heading" className="font-display text-2xl font-medium">
        {t("heading")}
      </h2>
      <p className="max-w-(--measure) text-base text-ink-2">{t("sub")}</p>
      {model.counters === null ? <PendingBanner what={t("pending")} /> : null}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {model.counters === null
          ? pendingLabels.map((label) => (
              <div key={label} className="flex flex-col gap-2 border-t border-edge pt-3" data-counter-pending="">
                <span role="img" aria-label={notScored} className="font-display text-3xl text-ink-3">
                  ###
                </span>
                <p className="text-sm text-ink-2">{label}</p>
              </div>
            ))
          : model.counters.map((counter) => (
              <div key={counter.id} className={`border-t pt-3 ${counter.id === "ours" || counter.id === "balanced" ? "border-signal" : "border-edge"}`} data-counter-id={counter.id}>
                <Counter size="numeral" value={counter.value} unit={counter.label} proof={counter.proof} />
              </div>
            ))}
      </div>
    </section>
  );
}

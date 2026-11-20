"use client";

import { useTranslations } from "next-intl";
import { formatClock } from "@/components/spine/geometry";
import { LEVEL_SIGN_HEIGHT } from "@/components/level/LevelSign";
import { Pictogram } from "@/components/level/Pictogram";
import { ProofChip } from "@/components/provenance/ProofChip";
import { proofFromForecast } from "@/components/provenance/proof";
import { FieldLink } from "@/components/shell/FieldLink";
import { Banner } from "@/components/states/Banner";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { Skeleton } from "@/components/states/Skeletons";
import { WakingLine } from "@/components/states/WakingLine";
import { ACTION_SECONDARY_DENSE } from "@/components/states/actions";
import { ActionLead } from "@/features/today/ActionLead";
import { alsoPictogram } from "@/features/today/action-codes";
import { isolateTime } from "@/features/today/labels";
import { LevelHeader } from "@/features/today/LevelHeader";
import { ProtectiveLead } from "@/features/today/ProtectiveLead";
import { SHIFT_STRIP_HEIGHT, ShiftSpine } from "@/features/today/ShiftSpine";
import { SiteEntry } from "@/features/today/SiteEntry";
import { useTodayModel, type TodayModel } from "@/features/today/useTodayModel";

/*
 * The worker's Today screen (F2 Task 16, restructured in redesign S5): what to do now, the site level, and the shift as one strip.
 * One column, the phone's width. It is read in three seconds: the action sentence and the level in one card, the strip under it,
 * then at most three "Also now" lines, the one clinical note of the screen beside "Why <level>?", and a quiet row when warnings are
 * off. The "I feel unwell" slab and the tabs are the dock (WorkerDock.tsx). The states (loading, empty, error, stale, offline,
 * fallback, out of season, no shift, personal, partial) are decided in describe.ts and useTodayModel.ts; this file only words and
 * lays them out.
 *
 * It reads `?at=`, `?site=` and `?crew=` (the replay clock and the pin), so the page puts it in its own <Suspense> boundary:
 * the rest of the page stays server rendered and this fills in after hydration, behind TodaySkeleton.
 */

/** The level card: the same box on the screen and in its skeleton. */
const CARD = "mx-4 flex flex-col gap-4 rounded-card bg-panel p-5";

/**
 * The height of the level card before its data arrives (CLS): the padding, the two-line action sentence, the gap, the rule and the
 * level sign at its published height. A sentence of three lines (some languages) grows the card past this floor.
 */
const CARD_HEIGHT = `calc(var(--s-5) * 2 + max(2.75rem, var(--t-28) * var(--sign-leading-display) * 2) + var(--s-4) * 2 + 1.5px + ${LEVEL_SIGN_HEIGHT.hero})`;

/** The placeholder of the whole screen, at the final element heights (CLS), shown until the forecast arrives. */
export function TodaySkeleton() {
  const t = useTranslations("states");
  return (
    <>
      <div role="status" aria-busy="true" data-today-skeleton="" className="flex flex-col gap-4 px-4 pt-3">
        <Skeleton height={CARD_HEIGHT} />
        <Skeleton height={SHIFT_STRIP_HEIGHT} />
        <span className="sr-only">{t("loading")}</span>
      </div>
      {/* Outside the busy region (a change inside it is not announced). The forecast read can be waiting for a scaled-to-zero API. */}
      <WakingLine className="px-4 pt-3" />
    </>
  );
}

function Ready({ model }: { readonly model: Extract<TodayModel, { status: "ready" }> }) {
  const t = useTranslations("worker.today");
  const partial = useTranslations("today.hero")("personalUnavailable");
  const levels = useTranslations("levels");
  const entry = useTranslations("worker.today.entry");
  const { description: d, forecast, synthetic, pushOff, pinFailed } = model;

  // The protective level of a not-live state is the plan's, not a reading: no "Why <level>?" and no proof of it (site rules instead).
  const levelName = d.level === null || d.notLive ? null : levels(`name.${d.level}`);
  // The chip's accessible name is the plain words (a <bdi> is markup, an accessible name is text); its visible words wrap the level in <bdi>.
  const plainWhy = (level: string) => t.markup("why.level", { level, bdi: (chunks) => chunks });
  const proof =
    synthetic === null
      ? null
      : proofFromForecast(forecast, levelName === null ? t("proofWhat.siteRules") : t("proofWhat.level", { level: levelName }), { synthetic });

  return (
    <div className={`flex flex-col gap-4 pb-6 ${d.notLive ? "" : "pt-3"}`}>
      {d.notLive ? (
        <ProtectiveLead
          description={d}
          mode={forecast.mode}
          updatedAt={d.banner === null ? null : d.banner.updatedAt}
          ageMs={d.banner === null ? null : d.banner.ageMs}
          offline={d.banner?.kind === "offline"}
        />
      ) : null}
      {pinFailed ? (
        <div className="px-4">
          <Banner>
            <p>{entry("pinFailed")}</p>
          </Banner>
        </div>
      ) : null}
      {d.personalUnavailable ? (
        <div className="px-4">
          <Banner>
            <p>{partial}</p>
          </Banner>
        </div>
      ) : null}

      {d.noShift ? (
        <>
          {d.notLive ? null : (
            <div className={CARD}>
              <LevelHeader description={d} mode={forecast.mode} className="" />
            </div>
          )}
          <div className="px-4">
            <EmptyState
              title={t("noShift.title", { crew: d.crewName ?? "" })}
              reason={t("noShift.reason")}
              primary={{ label: t("noShift.primary"), href: "/worker/alerts" }}
              {...(d.level === null ? {} : { level: d.level })}
            />
          </div>
        </>
      ) : d.notLive ? (
        <ShiftSpine description={d} />
      ) : (
        // The hero while the forecast is live: the level card (the action first, then the level) and the shift strip under it.
        <div data-hero="" className="flex flex-col gap-4">
          <div className={CARD}>
            <ActionLead lead={d.plan.lead} protective={d.protective} className="" />
            {d.offShift === null ? null : (
              // The lead above is the SITE's rule for the hour (ADR 0046): it is what to do for anyone working. The crew pages say this crew is off
              // shift now; so does this line, or the two screens read as a contradiction.
              <p data-off-shift="" className="text-base leading-(--sign-leading-text) text-ink-2">
                {d.offShift.backAtHour === null ? t("offShift.over") : t("offShift.back", { time: isolateTime(formatClock(d.offShift.backAtHour)) })}
              </p>
            )}
            <div className="border-t-[1.5px] border-hair pt-4">
              <LevelHeader description={d} mode={forecast.mode} className="" />
            </div>
          </div>
          <ShiftSpine description={d} />
        </div>
      )}

      {d.plan.also.length === 0 || d.noShift ? null : (
        <section aria-labelledby="also-now" className="flex flex-col gap-1 px-4">
          <h2 id="also-now" className="text-sm leading-(--sign-leading-text) font-medium text-ink-3">
            {t("also.heading")}
          </h2>
          <ol className="m-0 flex list-none flex-col p-0">
            {d.plan.also.map((item) => (
              <li
                key={item}
                className="grid min-h-14 grid-cols-[2rem_1fr] items-center gap-3.5 border-t-[1.5px] border-hair py-2 text-20 leading-(--sign-leading-text) font-medium text-ink"
              >
                <Pictogram name={alsoPictogram(item)} className="size-8 text-ink-2" />
                <span>{t(`also.${item}`)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* The ONE clinical note of the screen (decision D5), covering the lead and the list. The label is the honest one and stays. */}
      <div className="flex items-center justify-between gap-3 px-4">
        {d.noShift ? null : (
          <p data-clinical-note="" className="text-sm leading-(--sign-leading-text) text-ink-2">
            {t("draftWording")}
          </p>
        )}
        <div className="ms-auto">
          <ProofChip
            proof={proof}
            variant="quiet"
            label={levelName === null ? t("why.siteRules") : plainWhy(levelName)}
            labelContent={levelName === null ? undefined : t.rich("why.level", { level: levelName, bdi: (chunks) => <bdi>{chunks}</bdi> })}
          />
        </div>
      </div>

      {pushOff && !d.noShift ? (
        <div data-warnings-off="" className="mx-4 flex items-center justify-between gap-3 rounded-card bg-panel py-3 ps-4 pe-3">
          <p className="min-w-0 text-base leading-(--sign-leading-text) font-medium text-ink">{t("warningsOff")}</p>
          <FieldLink href="/worker/alerts" aria-label={t("turnOnWarnings")} className={`${ACTION_SECONDARY_DENSE} flex-none whitespace-nowrap`}>
            {t("turnOn")}
          </FieldLink>
        </div>
      ) : null}
    </div>
  );
}

export function TodayView() {
  const model = useTodayModel();
  const t = useTranslations("worker.today");
  const states = useTranslations("states");

  switch (model.status) {
    case "starting":
    case "loading":
      return <TodaySkeleton />;
    case "no-site":
      return <SiteEntry />;
    case "error":
      return (
        <div className="px-4 pt-6">
          <ErrorState title={states("error.title")} detail={states("error.detail")} onRetry={model.retry} requestId={model.problem.request_id ?? null}>
            <p className="max-w-(--measure) text-lg text-ink">{t("errorRules")}</p>
          </ErrorState>
        </div>
      );
    case "ready":
      return <Ready model={model} />;
  }
}

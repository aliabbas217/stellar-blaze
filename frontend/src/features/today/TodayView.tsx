"use client";

import { useTranslations } from "next-intl";
import { Pictogram } from "@/components/level/Pictogram";
import { ProofChip } from "@/components/provenance/ProofChip";
import { proofFromForecast } from "@/components/provenance/proof";
import { FieldLink } from "@/components/shell/FieldLink";
import { Banner } from "@/components/states/Banner";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { OfflineBanner } from "@/components/states/OfflineBanner";
import { LevelSignSkeleton, Skeleton } from "@/components/states/Skeletons";
import { StaleBanner } from "@/components/states/StaleBanner";
import { ACTION_PRIMARY } from "@/components/states/actions";
import { ActionLead } from "@/features/today/ActionLead";
import { LevelHeader } from "@/features/today/LevelHeader";
import { ShiftSpine, spineHeight } from "@/features/today/ShiftSpine";
import { SiteEntry } from "@/features/today/SiteEntry";
import { useAgeLabel, useTimeFormat } from "@/features/today/labels";
import { useTodayModel, type TodayModel } from "@/features/today/useTodayModel";

/*
 * The worker's Today screen (F2 Task 16): the site level now, what to do about it, and the shift on the Qaylula spine.
 * One column, the phone's width. The states (loading, empty, error, stale, offline, fallback, out of season, no shift,
 * personal, partial) are decided in describe.ts and useTodayModel.ts; this file only words and lays them out.
 *
 * It reads `?at=`, `?site=` and `?crew=` (the replay clock and the pin), so the page puts it in its own <Suspense> boundary:
 * the rest of the page stays server rendered and this fills in after hydration, behind TodaySkeleton.
 */

/** The shift the skeleton reserves room for: the usual day of the spine (06:00 to 18:00). */
const SKELETON_HOURS = 12;

/** The placeholder of the whole screen, at the final element heights (CLS), shown until the forecast arrives. */
export function TodaySkeleton() {
  const t = useTranslations("states");
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4 px-4 pt-3">
      <LevelSignSkeleton size="hero" />
      <Skeleton height="calc(max(2.5rem, var(--t-22) * var(--sign-leading-text)) + var(--s-2) + var(--t-16) * var(--sign-leading-text))" />
      <Skeleton height={spineHeight(SKELETON_HOURS)} />
      <span className="sr-only">{t("loading")}</span>
    </div>
  );
}

function Ready({ model }: { readonly model: Extract<TodayModel, { status: "ready" }> }) {
  const t = useTranslations("worker.today");
  const partial = useTranslations("today.hero")("personalUnavailable");
  const levels = useTranslations("levels");
  const time = useTimeFormat();
  const ageLabel = useAgeLabel();
  const { description: d, forecast, synthetic, pushOff } = model;

  const levelName = d.level === null ? null : levels(`name.${d.level}`);
  // The chip's accessible name is the plain words (a <bdi> is markup, an accessible name is text); its visible words wrap the level in <bdi>.
  const plainWhy = (level: string) => t.markup("why.level", { level, bdi: (chunks) => chunks });
  const proof =
    synthetic === null
      ? null
      : proofFromForecast(forecast, levelName === null ? t("proofWhat.siteRules") : t("proofWhat.level", { level: levelName }), { synthetic });

  return (
    <div className="flex flex-col gap-3 pb-6">
      {d.personalUnavailable ? (
        <div className="px-4">
          <Banner>
            <p>{partial}</p>
          </Banner>
        </div>
      ) : null}
      {d.banner === null ? null : (
        <div className="px-4">
          {d.banner.kind === "stale" ? (
            <StaleBanner updatedAt={time(d.banner.updatedAt)} ageLabel={ageLabel(d.banner.ageMs)} title={t("kicker.fallback")} />
          ) : (
            <OfflineBanner updatedAt={time(d.banner.updatedAt)} ageLabel={ageLabel(d.banner.ageMs)} />
          )}
        </div>
      )}

      <LevelHeader description={d} mode={forecast.mode} />

      {d.noShift ? (
        <div className="px-4">
          <EmptyState
            title={t("noShift.title", { crew: d.crewName ?? "" })}
            reason={t("noShift.reason")}
            primary={{ label: t("noShift.primary"), href: "/worker/alerts" }}
            {...(d.level === null ? {} : { level: d.level })}
          />
        </div>
      ) : (
        <>
          <ActionLead lead={d.plan.lead} protective={d.protective} />
          <ShiftSpine description={d} />
        </>
      )}

      {d.plan.also.length === 0 || d.noShift ? null : (
        <section aria-labelledby="also-now" className="flex flex-col gap-2 px-4">
          <h2 id="also-now" className="text-base font-medium text-ink-3">
            {t("also.heading")}
          </h2>
          <ol className="m-0 flex list-none flex-col p-0">
            {d.plan.also.map((item) => (
              <li
                key={item}
                className="grid grid-cols-[2.5rem_1fr] items-center gap-3 border-b border-hair py-3 text-xl leading-(--sign-leading-text) font-medium text-ink"
              >
                <Pictogram name={item === "water" ? "water" : "buddy"} className="size-10" />
                <span>{t(`also.${item}`)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="flex flex-col items-start gap-3 px-4">
        <ProofChip
          proof={proof}
          field
          label={levelName === null ? t("why.siteRules") : plainWhy(levelName)}
          labelContent={levelName === null ? undefined : t.rich("why.level", { level: levelName, bdi: (chunks) => <bdi>{chunks}</bdi> })}
        />
        {pushOff && !d.noShift ? (
          <FieldLink href="/worker/alerts" data-primary="" className={`${ACTION_PRIMARY} w-full min-h-14 touch-manipulation text-lg`}>
            {t("turnOnWarnings")}
          </FieldLink>
        ) : null}
      </div>
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
      return <SiteEntry status={model.entry} onDemoYard={model.demoYard} onRetry={model.retrySites} />;
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

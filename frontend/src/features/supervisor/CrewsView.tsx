"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, type ReactNode } from "react";
import { ModeStampRow, ModeStampSkeleton } from "@/components/provenance/ModeStamp";
import { FieldLink } from "@/components/shell/FieldLink";
import { ResetDemoControl } from "@/components/shell/ResetDemoControl";
import { SyntheticDemoBanner } from "@/components/shell/SyntheticDemoBanner";
import { Banner } from "@/components/states/Banner";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { Skeleton } from "@/components/states/Skeletons";
import { ACTION_PRIMARY } from "@/components/states/actions";
import { DEMO_CREW_ID, isDemoMode } from "@/features/demo/constants";
import { CrewStrips } from "@/features/supervisor/CrewStrips";
import { FocalSentence } from "@/features/supervisor/FocalSentence";
import { BAR_CLEARANCE, StopWorkBar } from "@/features/supervisor/StopWorkBar";
import { useCrewsModel, type CrewsModel } from "@/features/supervisor/useCrewsModel";
import { useStopWork, type ServerStop } from "@/features/supervisor/useStopWork";

/*
 * The supervisor's crews screen (F2 Task 19): which crew needs you first (one sentence), every crew across the day, worst
 * first (the hero), one primary action (open that crew's plan), and Stop work pinned for the focal crew. The states are decided
 * in useCrewsModel.ts; this file words and lays them out. It reads `?at=` (the replay clock), so the page puts it in its own
 * <Suspense> boundary and the rest of the page stays server rendered.
 *
 * Stop work is mounted outside every state: loading, error and empty included (see StopWorkBar.tsx).
 */

const bdi = (chunks: ReactNode): ReactNode => <bdi>{chunks}</bdi>;

/** The placeholder at the final heights: the lead, four crew rows and the legend (a crew row is its minimum height). */
export function CrewsSkeleton() {
  const t = useTranslations("states");
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4 px-4 pt-3">
      {isDemoMode() ? <ModeStampSkeleton /> : null}
      <Skeleton height="calc(var(--s-6) + var(--s-2) + var(--t-22) * var(--sign-leading-text, 1.5) * 3)" />
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} height="7rem" />
      ))}
      <span className="sr-only">{t("loading")}</span>
    </div>
  );
}

function Footnote({ names, k }: { readonly names: readonly string[]; readonly k: number | null }) {
  const t = useTranslations("supervisor.crews");
  const locale = useLocale();
  if (names.length === 0 || k === null) return null;
  const list = new Intl.ListFormat(locale, { type: "conjunction", style: "long" }).format(names);
  return (
    <p data-suppressed-note="" className="px-4 pt-2 text-base leading-(--sign-leading-text) text-ink-2">
      {t.rich(names.length === 1 ? "footnote.one" : "footnote.many", { crews: list, k: String(k), bdi })}
    </p>
  );
}

function Ready({ model }: { readonly model: Extract<CrewsModel, { status: "ready" }> }) {
  const t = useTranslations("supervisor.crews");
  const { focal } = model;
  return (
    <>
      <ModeStampRow mode={model.mode} className="px-4 pt-3" />
      {model.offline ? (
        <div className="px-4 pt-3">
          <Banner>
            <p>
              <strong className="block font-medium text-ink">{t("offline.title")}</strong>
              {t("offline.body")}
            </p>
          </Banner>
        </div>
      ) : null}
      {model.protective ? (
        <div className="px-4 pt-3">
          <Banner>
            <p>
              <strong className="block font-medium text-ink">{t("stale.title")}</strong>
              {t("stale.body")}
            </p>
          </Banner>
        </div>
      ) : null}

      <FocalSentence focal={focal} breakInMinutes={model.breakInMinutes} />
      <div className="pt-3">
        <CrewStrips crews={model.crews} from={model.from} to={model.to} nowHour={model.nowHour} ban={model.ban} heat={model.heat} />
      </div>
      <Footnote names={model.suppressedNames} k={model.k} />
      <div className="px-4 pt-4">
        <FieldLink href={`/supervisor/crews/${focal.crew.id}`} data-primary="" className={`${ACTION_PRIMARY} w-full min-h-14 touch-manipulation text-lg`}>
          <span>{t.rich("primary", { crew: focal.crew.name, bdi })}</span>
        </FieldLink>
      </div>
    </>
  );
}

export function CrewsView() {
  const { model, siteId, siteName } = useCrewsModel();
  const t = useTranslations("supervisor.crews");
  const states = useTranslations("states");
  const demo = isDemoMode();

  // The crew the bar is for: the focal one, kept on the crew a stop was pressed for while it is under way (the stop turns the crew
  // red and the ranking may move). While the list is not there the demo's own crew stands in, so the bar is live from the first paint.
  const focalId = model.status === "ready" ? model.focal.crew.id : null;
  const standIn = model.status === "ready" || model.status === "empty" ? null : demo ? DEMO_CREW_ID : null;
  const serverOf = useCallback(
    (crewId: string): ServerStop | null => {
      if (model.status !== "ready") return null;
      const crew = model.crews.find((candidate) => candidate.crew.id === crewId)?.crew;
      return crew === undefined ? null : { stopped: crew.stopped, activeStopId: crew.active_stop_id, stoppedAt: crew.stopped_at, asOf: model.crewsUpdatedAt };
    },
    [model],
  );
  // The crew's name as the list shows it: kept with a queued stop and used to name a crew in an expiry notice.
  const nameOf = useCallback(
    (crewId: string): string | null => (model.status === "ready" ? (model.crews.find((candidate) => candidate.crew.id === crewId)?.crew.name ?? null) : null),
    [model],
  );
  const work = useStopWork(focalId ?? standIn, serverOf, nameOf);
  const entry = model.status === "ready" ? model.crews.find((crew) => crew.crew.id === work.crewId) : undefined;

  let content: ReactNode;
  switch (model.status) {
    case "loading":
      content = <CrewsSkeleton />;
      break;
    case "error":
      content = (
        <div className="px-4 pt-4">
          <ErrorState
            title={t("error.title")}
            detail={states("error.detail")}
            onRetry={model.retry}
            requestId={model.problem?.request_id ?? null}
          />
        </div>
      );
      break;
    case "empty":
      content = (
        <div className="px-4 pt-4">
          <EmptyState title={t("empty.title")} reason={t("empty.reason")} primary={{ label: t("empty.primary"), href: "/" }} />
        </div>
      );
      break;
    case "ready":
      content = <Ready model={model} />;
      break;
  }

  return (
    <div className={`flex flex-1 flex-col ${BAR_CLEARANCE}`}>
      {demo ? <SyntheticDemoBanner siteName={siteName} /> : null}
      {content}
      {demo && siteId !== null ? (
        <div className="px-4 pt-6">
          <ResetDemoControl siteId={siteId} />
        </div>
      ) : null}
      <StopWorkBar
        crewName={entry?.crew.name ?? null}
        work={work.crewId === null ? null : work}
        notices={work}
        noCrew={model.status === "empty" ? "none" : "unavailable"}
      />
    </div>
  );
}

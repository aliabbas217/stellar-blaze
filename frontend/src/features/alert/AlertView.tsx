"use client";

import { useLocale, useTranslations } from "next-intl";
import { ViewTransition, type ReactNode } from "react";
import { LevelSign } from "@/components/level/LevelSign";
import { Pictogram } from "@/components/level/Pictogram";
import { ModeStamp } from "@/components/provenance/ModeStamp";
import { ProofChip } from "@/components/provenance/ProofChip";
import { proofFromForecast } from "@/components/provenance/proof";
import { FieldLink } from "@/components/shell/FieldLink";
import { formatClock } from "@/components/spine/geometry";
import { TimeSpine, type SpineWaypoint } from "@/components/spine/TimeSpine";
import { Banner } from "@/components/states/Banner";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { OfflineBanner } from "@/components/states/OfflineBanner";
import { LevelSignSkeleton, Skeleton } from "@/components/states/Skeletons";
import { StaleBanner } from "@/components/states/StaleBanner";
import { ACTION_PRIMARY } from "@/components/states/actions";
import type { AlertParams } from "@/features/alert/alert-params";
import { ChangedBracket } from "@/features/alert/ChangedBracket";
import { useAlertModel } from "@/features/alert/useAlertModel";
import type { Lead } from "@/features/today/action-codes";
import { isolateTime, useAgeLabel, useTimeFormat } from "@/features/today/labels";
import { dirFor } from "@/i18n/direction";
import "@/styles/view-transitions.css";

/*
 * The alert card (F2 Task 17): what a tap on a warning opens. The level in the hero, from when, what changed in the worker's
 * shift on a horizontal spine (the changed window framed, the rest dimmed), what to do in at most three lines, "Why?", and one
 * primary action, "Got it", which goes to Today. No audio (ADR 0061). The states are decided in useAlertModel.ts; this file
 * words them.
 */

/** Rows the horizontal spine reserves: the labels above the band (up to three), the band and the tick row. */
/** A level name inside a phrase keeps its own direction: an Urdu name in an English phrase must not reorder the text around it. */
const bdi = (chunks: ReactNode) => <bdi>{chunks}</bdi>;

const SPINE_SKELETON = "calc(var(--t-16) * var(--sign-leading-text, var(--leading-body)) * 6 + var(--s-8))";

export function AlertSkeleton() {
  const t = useTranslations("states");
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4 px-4 pt-3">
      <LevelSignSkeleton size="hero" />
      <Skeleton height={SPINE_SKELETON} />
      <span className="sr-only">{t("loading")}</span>
    </div>
  );
}

export function AlertView({ params }: { readonly params: AlertParams }) {
  const model = useAlertModel(params);
  const t = useTranslations("worker.alert");
  const today = useTranslations("worker.today");
  const levels = useTranslations("levels");
  const states = useTranslations("states");
  const partial = useTranslations("today.hero")("personalUnavailable");
  const locale = useLocale();
  const time = useTimeFormat();
  const ageLabel = useAgeLabel();
  const kicker = t(`kicker.${params.audience}`);
  const leadText = (lead: Lead): string =>
    lead.kind === "cycle" ? today("lead.cycle", { work: String(lead.workMinutes), rest: String(lead.restMinutes) }) : today(`lead.${lead.kind}`);
  const fromLabel = (iso: string) => time(new Date(iso));

  if (model.status === "loading") return <AlertSkeleton />;

  if (model.status === "ended") {
    return (
      <div className="px-4 pt-4">
        <EmptyState
          title={t("ended.title", { time: time(model.endedAt) })}
          reason={t("ended.reason")}
          primary={{ label: t("ended.primary"), href: "/worker" }}
        />
      </div>
    );
  }

  if (model.status === "saved") {
    // Nothing to read the window from: the card says what the notification itself said, and what to do without a forecast. A
    // forecast that was had but does not place the warning is not a failure (no error block), and it never reads "ended".
    return (
      <div className="flex flex-col gap-4 pb-6">
        <div className="px-4 pt-3">
          {model.offline ? (
            <OfflineBanner />
          ) : (
            <Banner>
              <p>{model.cause === "not-covered" ? t("notCovered") : t("saved")}</p>
            </Banner>
          )}
        </div>
        <section aria-label={kicker} className="flex flex-col gap-3 px-4">
          <LevelSign
            level={params.level}
            kind="stale"
            size="hero"
            kicker={kicker}
            until={t.rich("from", { time: fromLabel(params.validFrom), bdi: (chunks) => <bdi>{chunks}</bdi> })}
          />
        </section>
        <section aria-label={t("doNow")} className="px-4">
          <p className="grid grid-cols-[2.5rem_1fr] items-center gap-3 text-xl leading-(--sign-leading-text) font-medium text-ink">
            <Pictogram name="shade" className="size-10" />
            <span>{today("lead.siteRules")}</span>
          </p>
        </section>
        {model.offline || model.cause === "not-covered" ? null : (
          <div className="px-4">
            <ErrorState title={states("error.title")} detail={states("error.detail")} onRetry={model.retry} requestId={model.problem?.request_id ?? null} />
          </div>
        )}
        <div className="px-4">
          <FieldLink href="/worker" data-primary="" className={`${ACTION_PRIMARY} w-full min-h-14 touch-manipulation text-lg`}>
            {t("gotIt")}
          </FieldLink>
        </div>
      </div>
    );
  }

  const { window: run, plan } = model;
  const levelName = levels(`name.${run.level}`);
  const lines: { key: string; icon: "shade" | "water" | "buddy"; text: string }[] = [
    { key: "lead", icon: "shade", text: leadText(plan.lead) },
    ...plan.also.map((item) => ({ key: item, icon: item === "water" ? ("water" as const) : ("buddy" as const), text: today(`also.${item}`) })),
  ];
  const waypoints: SpineWaypoint[] = [
    ...(model.nowHour === null ? [] : [{ at: model.nowHour, title: t("spine.now") }]),
    { at: model.changedFrom, title: t("spine.starts", { level: levelName, time: isolateTime(formatClock(model.changedFrom)) }) },
    ...(model.changedTo === null ? [] : [{ at: model.changedTo, title: t("spine.ends", { time: isolateTime(formatClock(model.changedTo)) }) }]),
  ].sort((a, b) => a.at - b.at);
  const summary = waypoints.map((waypoint) => waypoint.title ?? "").join(". ");
  const proof =
    model.forecast === null || model.synthetic === null
      ? null
      : proofFromForecast(model.forecast, today("proofWhat.level", { level: levelName }), { synthetic: model.synthetic });
  const dir = dirFor(locale);

  return (
    <div className="flex flex-col gap-4 pb-6">
      {model.personalUnavailable ? (
        <div className="px-4 pt-3">
          <Banner>
            <p>{partial}</p>
          </Banner>
        </div>
      ) : null}
      {model.offline ? (
        <div className="px-4 pt-3">
          <OfflineBanner
            {...(model.updatedAt === null ? {} : { updatedAt: time(model.updatedAt), ageLabel: ageLabel(model.ageMs) })}
          />
        </div>
      ) : model.stale && model.updatedAt !== null ? (
        <div className="px-4 pt-3">
          <StaleBanner updatedAt={time(model.updatedAt)} ageLabel={ageLabel(model.ageMs)} />
        </div>
      ) : null}

      <div data-hero="" className="flex flex-col gap-4">
        <ViewTransition name="level" share="morph" default="none">
          <section aria-label={kicker} className="flex flex-col gap-3 px-4 pt-3">
            <LevelSign
              level={run.level}
              kind={model.stale || model.offline ? "stale" : "live"}
              size="hero"
              kicker={kicker}
              stamp={<ModeStamp mode={model.forecast?.mode ?? null} />}
              until={t.rich("from", { time: fromLabel(run.from), bdi: (chunks) => <bdi>{chunks}</bdi> })}
            />
            {model.personalHigher === null ? null : (
              <p className="text-lg font-medium text-ink">{t.rich("personalHigher", { level: levels(`name.${model.personalHigher}`), bdi })}</p>
            )}
          </section>
        </ViewTransition>

        <section aria-labelledby="alert-changed" className="flex flex-col gap-2">
          <h2 id="alert-changed" className="px-4 text-base font-medium text-ink-3">
            {t("changed.heading")}
          </h2>
          <p className="px-4 text-lg text-ink-2">
            {run.previous === null
              ? t.rich("changed.now", { level: levelName, bdi })
              : t.rich("changed.was", { previous: levels(`name.${run.previous}`), level: levelName, bdi })}
          </p>
          <ChangedBracket from={model.from} to={model.to} changedFrom={model.changedFrom} changedTo={model.changedTo} dir={dir}>
            <TimeSpine
              orientation="h"
              surface="field"
              dir={dir}
              from={model.from}
              to={model.to}
              cells={model.cells}
              now={model.nowHour}
              ban={{ kind: "not-in-force", resumesLabel: null, outline: null }}
              waypoints={waypoints}
              aria={t("spine.aria", { summary })}
              transitionName={null}
            />
          </ChangedBracket>
        </section>
      </div>

      <section aria-label={t("doNow")} className="flex flex-col gap-1 px-4">
        <ol className="m-0 flex list-none flex-col p-0">
          {lines.slice(0, 3).map((line) => (
            <li key={line.key} className="grid grid-cols-[2.5rem_1fr] items-center gap-3 border-b border-hair py-3 text-xl leading-(--sign-leading-text) font-medium text-ink">
              <Pictogram name={line.icon} className="size-10" />
              <span>{line.text}</span>
            </li>
          ))}
        </ol>
        <p className="pt-1 text-base leading-(--sign-leading-text) text-ink-2">{today("draftWording")}</p>
      </section>

      <div className="flex flex-col items-start gap-3 px-4">
        <ProofChip
          proof={proof}
          field
          label={today.markup("why.level", { level: levelName, bdi: (chunks) => chunks })}
          labelContent={today.rich("why.level", { level: levelName, bdi })}
        />
        <FieldLink href="/worker" data-primary="" className={`${ACTION_PRIMARY} w-full min-h-14 touch-manipulation text-lg`}>
          {t("gotIt")}
        </FieldLink>
      </div>
    </div>
  );
}

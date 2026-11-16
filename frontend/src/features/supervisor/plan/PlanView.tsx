"use client";

import { useTranslations } from "next-intl";
import { Fragment, lazy, Suspense, useCallback, type ReactNode } from "react";
import { ModeStamp, ModeStampSkeleton } from "@/components/provenance/ModeStamp";
import { useFieldCrewLabel } from "@/components/shell/FieldHeading";
import { FieldLink } from "@/components/shell/FieldLink";
import { ResetDemoControl } from "@/components/shell/ResetDemoControl";
import { SyntheticDemoBanner } from "@/components/shell/SyntheticDemoBanner";
import { Banner } from "@/components/states/Banner";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { Skeleton } from "@/components/states/Skeletons";
import { isDemoMode } from "@/features/demo/constants";
import { FocalSentence } from "@/features/supervisor/FocalSentence";
import { BAR_CLEARANCE, StopWorkBar } from "@/features/supervisor/StopWorkBar";
import { useStopWork, type ServerStop } from "@/features/supervisor/useStopWork";
import { BlockRows } from "@/features/supervisor/plan/BlockRows";
import { FloorBanner } from "@/features/supervisor/plan/FloorBanner";
import { PlanStrip } from "@/features/supervisor/plan/PlanStrip";
import { ShiftNotLegalResult } from "@/features/supervisor/plan/ShiftNotLegalResult";
import { usePlanModel, type PlanScreen } from "@/features/supervisor/plan/usePlanModel";
import { useTimeFormat } from "@/lib/time/use-time-format";

/*
 * The supervisor's plan screen for one crew (F2 Task 20): the crew's level now in one sentence, the day's plan against the heat (the
 * hero), every block as a row, the floor banner, and sign-off. Stop work is pinned at the foot of every state of this page and
 * has nothing to do with the rest of it: it is mounted outside every state and outside the sign-off form, its crew is the one in
 * the URL (so it works while the plan is loading, failed, refused or being signed), and sign-off never reads or writes its state.
 *
 * The state is decided in usePlanModel.ts; this file words and lays it out. It reads `?at=` (the replay clock), so the page puts
 * it in its own <Suspense> boundary.
 */

const bdi = (chunks: ReactNode): ReactNode => <bdi>{chunks}</bdi>;

// Loaded on demand: a signed plan, or a plan that did not load, never pays for the form.
const SignOffForm = lazy(() => import("@/features/supervisor/plan/SignOffForm"));

/** The placeholder at the final heights: the title, the lead sentence, the chart, and a few rows. */
export function PlanSkeleton() {
  const t = useTranslations("states");
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4 px-4 pt-3">
      {isDemoMode() ? <ModeStampSkeleton /> : null}
      <Skeleton height="3.5rem" />
      <Skeleton height="calc(var(--s-6) + var(--s-2) + var(--t-22) * var(--sign-leading-text, 1.5) * 3)" />
      <Skeleton height="11rem" />
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} height="2.75rem" />
      ))}
      <span className="sr-only">{t("loading")}</span>
    </div>
  );
}

function BackLink() {
  const t = useTranslations("supervisor.plan");
  return (
    <div className="px-4 pt-2">
      <FieldLink href="/supervisor" className="inline-flex min-h-11 items-center gap-2 text-base font-medium text-ink no-underline hover:underline">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0">
          <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.5" fill="none" />
        </svg>
        {t("back")}
      </FieldLink>
    </div>
  );
}

/** "Concrete pour · heavy work · 20 people": what the crew does and how big it is, without anything member-derived for a small crew. */
function Subtitle({ screen, suppressed, restricted }: { readonly screen: PlanScreen; readonly suppressed: boolean; readonly restricted: number | null }) {
  const t = useTranslations("supervisor.plan");
  const { crew, timeline } = screen;
  const parts: ReactNode[] = [];
  if (crew !== undefined) {
    parts.push(<bdi key="task">{crew.task_label}</bdi>, <Fragment key="load">{t(`workload.${crew.workload}`)}</Fragment>);
    if (suppressed) {
      // A k-suppressed crew keeps its level and says only that it is small. The count, and anything about restrictions, stay out.
      if (timeline !== undefined) parts.push(<Fragment key="people">{t.rich("peopleHidden", { k: String(timeline.k), bdi })}</Fragment>);
    } else {
      parts.push(<Fragment key="people">{t.rich("people", { count: String(crew.member_count), bdi })}</Fragment>);
    }
  }
  // Declared, not enforced per member: the plan states restrictions, it does not say who is protected by them.
  if (!suppressed && restricted !== null && restricted > 0) {
    parts.push(<Fragment key="restricted">{restricted === 1 ? t.rich("restrictions.one", { bdi }) : t.rich("restrictions.many", { count: String(restricted), bdi })}</Fragment>);
  }
  if (parts.length === 0) return null;
  return (
    <p data-crew-subtitle="" className="text-base leading-(--sign-leading-text) text-ink-2">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index === 0 ? null : " · "}
          {part}
        </Fragment>
      ))}
    </p>
  );
}

function SignedRow({ at }: { readonly at: string | null }) {
  const t = useTranslations("supervisor.plan");
  const time = useTimeFormat();
  // A signed plan always says so: with no time on record it reads "Signed" alone (never neither the row nor the form).
  return (
    <p role="status" data-signed="" className="flex items-start gap-3 px-4 pt-6 text-base font-medium leading-(--sign-leading-text) text-ink">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-1 size-5 shrink-0">
        <path d="M4 12l5 5L20 6" stroke="currentColor" strokeWidth="2.5" fill="none" />
      </svg>
      <span>{at === null ? t("signOff.signedNoTime") : t.rich("signOff.signed", { time: time(new Date(at)), bdi })}</span>
    </p>
  );
}

function Notices({ screen }: { readonly screen: PlanScreen }) {
  const t = useTranslations("supervisor.plan");
  const crews = useTranslations("supervisor.crews");
  const time = useTimeFormat();
  const { state } = screen;
  if (state.status !== "ready") return null;
  const { plan } = state;
  const note = (key: string, children: ReactNode): ReactNode => (
    <div key={key} className="px-4 pt-3">
      <Banner>
        <p>{children}</p>
      </Banner>
    </div>
  );
  return (
    <>
      {screen.offline
        ? note(
            "offline",
            <>
              <strong className="block font-medium text-ink">{crews("offline.title")}</strong>
              {crews("offline.body")}
            </>,
          )
        : null}
      {state.refreshFailed !== null
        ? note(
            "refresh-failed",
            <>
              <strong className="block font-medium text-ink">{t("refreshFailed.title")}</strong>
              {t("refreshFailed.body")}{" "}
              <button type="button" onClick={state.refreshFailed.retry} className="min-h-11 touch-manipulation font-medium text-ink underline underline-offset-4">
                {t("refreshFailed.retry")}
              </button>
            </>,
          )
        : null}
      {state.protective
        ? note(
            "stale",
            <>
              <strong className="block font-medium text-ink">{crews("stale.title")}</strong>
              {crews("stale.body")}
            </>,
          )
        : null}
      {plan.signoff_state === "unsigned" ? note("unsigned", t("unsigned")) : null}
      {plan.signoff_state === "changed_since_signed"
        ? note("changed", plan.signed_at === null ? t("changedNoTime") : t.rich("changed", { time: time(new Date(plan.signed_at)), bdi }))
        : null}
    </>
  );
}

function Body({ screen }: { readonly screen: PlanScreen }) {
  const t = useTranslations("supervisor.plan");
  const { state } = screen;
  const crewName = screen.crew?.name ?? screen.timeline?.crew_name ?? null;

  if (state.status === "loading") return <PlanSkeleton />;

  if (state.status === "failed") {
    const { failure } = state;
    return (
      <div className="px-4 pt-4">
        {failure.kind === "not-legal" ? (
          <ShiftNotLegalResult violations={failure.violations} />
        ) : failure.kind === "not-found" ? (
          <EmptyState title={t("notFound.title")} reason={t("notFound.reason")} primary={{ label: t("notFound.primary"), href: "/supervisor" }} />
        ) : failure.kind === "invalid" ? (
          <ErrorState title={t("invalid.title")} detail={t("invalid.detail")} onRetry={state.retry} requestId={state.problem.request_id ?? null} />
        ) : (
          <ErrorState title={t("error.title")} detail={t("error.detail")} onRetry={state.retry} requestId={state.problem.request_id ?? null} />
        )}
      </div>
    );
  }

  if (state.status === "empty") {
    return (
      <div className="px-4 pt-4">
        <EmptyState title={t("empty.title")} reason={t("empty.reason")} primary={{ label: t("empty.primary"), href: "/supervisor" }} />
      </div>
    );
  }

  const { plan } = state;
  const signed = plan.signoff_state === "signed";
  return (
    <>
      {/* The hero is the plan with the state it stands in: what the crews see (the notices), the level now, the chart and its blocks. */}
      <section data-spine="" data-hero="" aria-labelledby="plan-title" className="flex flex-col">
        <Notices screen={screen} />
        {screen.strip !== null ? (
          <FocalSentence focal={screen.strip} breakInMinutes={screen.breakInMinutes} kicker={t("kicker")} />
        ) : screen.stripPending ? (
          <div className="px-4 pt-3">
            <Skeleton height="calc(var(--t-16) * var(--sign-leading-text, 1.5) + var(--s-2) + var(--t-22) * var(--sign-leading-text, 1.5) * 2)" />
          </div>
        ) : null}
        <div className="pt-3" />
        <PlanStrip crewName={crewName} blocks={state.blocks} axis={state.axis} heat={state.heat} ban={state.ban} nowMin={state.nowMin} />
        <BlockRows blocks={state.blocks} currentIndex={state.currentIndex} nowMin={state.nowMin} />
      </section>
      <div className="pt-4">
        <FloorBanner code={plan.banner_code} />
      </div>
      {signed ? (
        <SignedRow at={plan.signed_at} />
      ) : state.refreshFailed !== null ? null : (
        // Sign-off is never offered on a plan whose latest read failed: what would be signed may no longer be the plan.
        <Suspense fallback={<div className="px-4 pt-6"><Skeleton height="14rem" /></div>}>
          <SignOffForm crewId={screen.crewId} date={plan.date} items={state.items} zone={screen.zone} />
        </Suspense>
      )}
    </>
  );
}

export function PlanView({ crewId }: { readonly crewId: string }) {
  const screen = usePlanModel(crewId);
  const t = useTranslations("supervisor.plan");
  const demo = isDemoMode();
  const crewName = screen.crew?.name ?? screen.timeline?.crew_name ?? null;
  useFieldCrewLabel(crewName);

  const serverOf = useCallback(
    (id: string): ServerStop | null => {
      const crew = screen.crews?.find((candidate) => candidate.id === id);
      return crew === undefined ? null : { stopped: crew.stopped, activeStopId: crew.active_stop_id, stoppedAt: crew.stopped_at, asOf: screen.crewsUpdatedAt };
    },
    [screen.crews, screen.crewsUpdatedAt],
  );
  // The bar is for the crew in the URL, whatever else is loading or failing. The one exception is a crew that does not exist.
  const notFound = screen.state.status === "failed" && screen.state.failure.kind === "not-found";
  const nameOf = useCallback(
    (id: string): string | null => screen.crews?.find((candidate) => candidate.id === id)?.name ?? (id === crewId ? crewName : null),
    [screen.crews, crewId, crewName],
  );
  const work = useStopWork(notFound ? null : crewId, serverOf, nameOf);

  const state = screen.state;
  const suppressed = state.status === "ready" ? state.plan.suppressed : false;
  const restricted = state.status === "ready" ? state.plan.restricted_headcount : null;

  return (
    <div className={`flex flex-1 flex-col ${BAR_CLEARANCE}`}>
      {demo ? <SyntheticDemoBanner siteName={screen.siteName} /> : null}
      <BackLink />
      {!notFound ? (
        <div className="flex flex-col gap-1 px-4 pt-1">
          <div className="flex items-start justify-between gap-3">
            <h2 id="plan-title" data-plan-title="" className="font-display text-xl font-medium leading-(--sign-leading-text) text-ink">
              {crewName === null ? t("titleGeneric") : t.rich("title", { crew: crewName, bdi })}
            </h2>
            <ModeStamp mode={state.status === "ready" ? screen.mode : null} />
          </div>
          <Subtitle screen={screen} suppressed={suppressed || screen.timeline?.suppressed === true} restricted={restricted} />
        </div>
      ) : null}
      <Body screen={screen} />
      {demo && screen.siteId !== null ? (
        <div className="px-4 pt-6">
          <ResetDemoControl siteId={screen.siteId} />
        </div>
      ) : null}
      <StopWorkBar crewName={crewName} work={notFound ? null : work} notices={work} noCrew="none" />
    </div>
  );
}

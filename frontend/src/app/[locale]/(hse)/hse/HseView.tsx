"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
import { crewsQueryOptions } from "@/api/queries";
import type { components } from "@/api/schema";
import { FieldLink } from "@/components/shell/FieldLink";
import { MachineTranslationNotice } from "@/components/shell/MachineTranslationNotice";
import { ResetDemoControl } from "@/components/shell/ResetDemoControl";
import { SyntheticDemoBanner } from "@/components/shell/SyntheticDemoBanner";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { Skeleton } from "@/components/states/Skeletons";
import { WakingLine } from "@/components/states/WakingLine";
import { ACTION_SECONDARY } from "@/components/states/actions";
import { isDemoMode } from "@/features/demo/constants";
import { useDemo } from "@/features/demo/DemoProvider";
import { DemoSwitch } from "@/features/demo/DemoSwitch";
import { sitesQueryOptions } from "@/features/demo/sites";

type Crew = components["schemas"]["Crew"];

/** The same freshness the supervisor's crews screen asks for (the BFF's per-client budget is 20 reads a minute). */
const STALE_MS = 30_000;

/** The anchor of the demo controls: the tour links to it. */
export const DEMO_CONTROLS_ID = "demo-controls";

/**
 * The body of the safety view: one row per crew of the demo site with its plan (signed, not signed, or changed since it was signed) and
 * whether its work is stopped; the privacy sentence; the boundary panel; the demo controls. Four states: loading (a skeleton at the final
 * height), error (retry, with the request id), empty (the service returned no crews: a link back to the front door) and data. It reads
 * only the crews list, which carries a head count at most and nothing about any one worker, so the page cannot show an individual.
 */
export function HseView() {
  const t = useTranslations("hse");
  const states = useTranslations("states");
  const { site, siteStatus } = useDemo();
  const sitesQuery = useQuery(sitesQueryOptions());
  const siteId = site?.id ?? null;
  const crewsQuery = useQuery({ ...crewsQueryOptions(siteId ?? ""), enabled: siteId !== null, staleTime: STALE_MS });
  const demo = isDemoMode();

  let content: ReactNode;
  if (siteStatus === "error") {
    content = (
      <ErrorState
        title={t("error.title")}
        detail={states("error.detail")}
        onRetry={() => void sitesQuery.refetch()}
        requestId={sitesQuery.error?.problem.request_id ?? null}
      />
    );
  } else if (crewsQuery.isError && crewsQuery.data === undefined) {
    content = (
      <ErrorState
        title={t("error.title")}
        detail={states("error.detail")}
        onRetry={() => void crewsQuery.refetch()}
        requestId={crewsQuery.error.problem.request_id ?? null}
      />
    );
  } else if (siteStatus === "ready" && siteId === null) {
    content = <Empty />;
  } else if (crewsQuery.data === undefined) {
    content = <Loading />;
  } else if (crewsQuery.data.length === 0) {
    content = <Empty />;
  } else {
    content = <CrewTable crews={crewsQuery.data} />;
  }

  return (
    <>
      {demo ? <SyntheticDemoBanner siteName={site?.name ?? null} /> : null}
      {content}
      <p data-privacy="" className="max-w-(--measure) text-base font-semibold text-ink">
        {t("privacy")}
      </p>
      <section aria-labelledby="hse-boundary" data-boundary="" className="flex flex-col items-start gap-3 rounded-card bg-panel p-4 inset-ring-[1.5px] inset-ring-edge">
        <h2 id="hse-boundary" className="font-display text-lg font-medium text-ink">
          {t("boundary.title")}
        </h2>
        <p className="max-w-(--measure) text-base text-ink-2">{t("boundary.body")}</p>
        <FieldLink href="/replay/governance" className={ACTION_SECONDARY}>
          {t("boundary.link")}
        </FieldLink>
      </section>
      {demo ? <DemoControls siteId={siteId} /> : null}
      <MachineTranslationNotice />
    </>
  );
}

function Loading() {
  const states = useTranslations("states");
  return (
    <>
      <div role="status" aria-busy="true" className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} height="4.5rem" />
        ))}
        <span className="sr-only">{states("loading")}</span>
      </div>
      {/* Outside the busy region (a change inside it is not announced): the API can be waking from zero. */}
      <WakingLine />
    </>
  );
}

function Empty() {
  const t = useTranslations("hse");
  return <EmptyState title={t("empty.title")} reason={t("empty.reason")} primary={{ label: t("empty.primary"), href: "/start" }} />;
}

function planKey(state: Crew["signoff_state"]): "signed" | "unsigned" | "changed" {
  return state === "changed_since_signed" ? "changed" : state;
}

function CrewTable({ crews }: { readonly crews: readonly Crew[] }) {
  const t = useTranslations("hse");
  return (
    <table data-crews="" className="w-full border-collapse text-start text-base">
      <caption className="sr-only">{t("table.caption")}</caption>
      <thead>
        <tr className="border-b border-edge text-sm text-ink-2">
          <th scope="col" className="py-2 pe-2 text-start font-medium">
            {t("table.crew")}
          </th>
          <th scope="col" className="px-2 py-2 text-start font-medium">
            {t("table.plan")}
          </th>
          <th scope="col" className="py-2 ps-2 text-start font-medium">
            {t("table.work")}
          </th>
        </tr>
      </thead>
      <tbody>
        {crews.map((crew) => (
          <tr key={crew.id} data-crew={crew.id} data-stopped={String(crew.stopped)} className="border-b border-hair align-top">
            <th scope="row" className="py-3 pe-2 text-start font-semibold text-ink">
              <bdi>{crew.name}</bdi>
              <span className="block text-sm font-normal text-ink-2">
                <bdi>{crew.task_label}</bdi>
              </span>
            </th>
            <td className="px-2 py-3 text-ink">{t(`plan.${planKey(crew.signoff_state)}`)}</td>
            <td className="py-3 ps-2 text-ink">
              {/* A filled square for a stop and an empty one for none: told apart by shape and words, never by colour alone. */}
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className={`size-2.5 flex-none border border-ink ${crew.stopped ? "bg-ink" : ""}`} />
                <span className={crew.stopped ? "font-semibold" : ""}>{t(crew.stopped ? "work.stopped" : "work.running")}</span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The demo scaffolding (Replay or Live, Reset demo site), out of the way: a closed disclosure with a 44 px summary. It opens by itself when
 * the page is opened at `#demo-controls` (the tour links there), because a browser does not open a closed <details> for its own id.
 */
function DemoControls({ siteId }: { readonly siteId: string | null }) {
  const t = useTranslations("hse");
  const details = useRef<HTMLDetailsElement>(null);
  // The DOM is the external system here: open the element the address names (the section is otherwise uncontrolled, so a tap on its summary just works).
  useEffect(() => {
    if (window.location.hash === `#${DEMO_CONTROLS_ID}`) details.current?.setAttribute("open", "");
  }, []);

  return (
    <details
      ref={details}
      id={DEMO_CONTROLS_ID}
      data-demo-controls=""
      className="rounded-card bg-panel inset-ring-[1.5px] inset-ring-hair"
    >
      <summary className="flex min-h-(--target) cursor-pointer items-center px-4 font-semibold text-ink">{t("demo.title")}</summary>
      <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
        <DemoSwitch />
        <ResetDemoControl siteId={siteId ?? undefined} />
      </div>
    </details>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { lazy, Suspense, type ReactNode } from "react";
import { crewsQueryOptions } from "@/api/queries";
import { Skeleton } from "@/components/states/Skeletons";
import { useDemo } from "@/features/demo/DemoProvider";
import { sitesQueryOptions } from "@/features/demo/sites";

/** The states and the waking line that only some visits reach load on demand, like the Demo controls: the route budget has no room for them in the first load. */
const HseError = lazy(() => import("./HseStates").then((module) => ({ default: module.HseError })));
const HseEmpty = lazy(() => import("./HseStates").then((module) => ({ default: module.HseEmpty })));
const CrewTable = lazy(() => import("./HseTable"));
const WakingLine = lazy(() => import("@/components/states/WakingLine").then((module) => ({ default: module.WakingLine })));

/** The same freshness the supervisor's crews screen asks for (the BFF's per-client budget is 20 reads a minute). */
const STALE_MS = 30_000;

/**
 * The crews of the safety view: one row per crew of the demo site with its plan (signed, not signed, or changed since it was signed) and
 * whether its work is stopped. Four states: loading (a skeleton at the final height), error (retry, with the request id), empty (the
 * service returned no crews: a link back to the front door) and data. It reads only the crews list, which carries a head count at most and
 * nothing about any one worker, so it cannot show an individual. The static parts of the page (privacy sentence, boundary, demo
 * controls) are the page's own server markup, not this file: the route has no room for them in client script.
 */
export function HseView() {
  const { site, siteStatus } = useDemo();
  const sitesQuery = useQuery(sitesQueryOptions());
  const siteId = site?.id ?? null;
  const crewsQuery = useQuery({ ...crewsQueryOptions(siteId ?? ""), enabled: siteId !== null, staleTime: STALE_MS });

  let content: ReactNode;
  if (siteStatus === "error") {
    content = (
      <Suspense fallback={<Loading />}>
        <HseError onRetry={() => void sitesQuery.refetch()} requestId={sitesQuery.error?.problem.request_id ?? null} />
      </Suspense>
    );
  } else if (crewsQuery.isError && crewsQuery.data === undefined) {
    content = (
      <Suspense fallback={<Loading />}>
        <HseError onRetry={() => void crewsQuery.refetch()} requestId={crewsQuery.error.problem.request_id ?? null} />
      </Suspense>
    );
  } else if (siteStatus === "ready" && siteId === null) {
    content = <Empty />;
  } else if (crewsQuery.data === undefined) {
    content = <Loading />;
  } else if (crewsQuery.data.length === 0) {
    content = <Empty />;
  } else {
    content = (
      <Suspense fallback={<Loading />}>
        <CrewTable crews={crewsQuery.data} />
      </Suspense>
    );
  }

  return <>{content}</>;
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
      <Suspense fallback={null}>
        <WakingLine />
      </Suspense>
    </>
  );
}

function Empty() {
  return (
    <Suspense fallback={<Loading />}>
      <HseEmpty />
    </Suspense>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { crewsQueryOptions } from "@/api/queries";
import type { components } from "@/api/schema";
import { ErrorState } from "@/components/states/ErrorState";
import { Skeleton } from "@/components/states/Skeletons";
import { WakingLine } from "@/components/states/WakingLine";
import { FieldLink } from "@/components/shell/FieldLink";
import { splitDemoName } from "@/components/shell/site-name";
import { joinHref } from "@/features/join/link";

/*
 * The picker of the join page (redesign S6a): the worker has no code (a torn poster, a new phone) and finds the site, then the crew.
 * Both lists are the public reads. Every row is a plain link to the join page with the ids in its query, so a pick is the same thing as
 * scanning a code: it opens the confirm card, the browser's back button works, and following a row needs no script.
 *
 * The API lists only the demo site today, and the page says so (never a list that looks like many real workplaces): the note shows
 * whenever every listed workplace is synthetic. A site with no listed crews says who to ask, never an empty list.
 */

type Site = components["schemas"]["Site"];

const ROW =
  "flex min-h-(--target-field) w-full items-center justify-between gap-3 rounded-ctl bg-panel px-4 py-2 text-start text-lg font-medium text-ink no-underline active:scale-[0.985]";

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 flex-none text-ink-3 rtl:-scale-x-100">
      <path fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="square" d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** The rows' placeholder: two rows at the height of a row, so the list arriving moves nothing (CLS). */
export function RowsSkeleton(): ReactNode {
  const states = useTranslations("states");
  return (
    <>
      <div role="status" aria-busy="true" className="flex flex-col gap-2">
        <Skeleton height="var(--target-field)" />
        <Skeleton height="var(--target-field)" />
        <span className="sr-only">{states("loading")}</span>
      </div>
      <WakingLine />
    </>
  );
}

export function SitePicker({ sites }: { readonly sites: readonly Site[] }): ReactNode {
  const t = useTranslations("worker.join");
  const allDemo = sites.length > 0 && sites.every((site) => site.synthetic);
  return (
    <section aria-labelledby="join-workplaces" className="flex flex-col gap-2">
      <h2 id="join-workplaces" className="text-base leading-(--sign-leading-text) font-medium text-ink-3">
        {t("workplaces")}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {sites.map((site) => {
          const { name } = splitDemoName(site.name, site.synthetic);
          return (
            <li key={site.id}>
              <FieldLink href={joinHref(site.id)} className={ROW}>
                <bdi>{name}</bdi>
                <Chevron />
              </FieldLink>
            </li>
          );
        })}
      </ul>
      {allDemo ? <p className="text-base leading-(--sign-leading-text) text-ink-2">{t("demoOnly")}</p> : null}
    </section>
  );
}

export function CrewPicker({ site }: { readonly site: Site }): ReactNode {
  const t = useTranslations("worker.join");
  const states = useTranslations("states");
  const crews = useQuery(crewsQueryOptions(site.id));
  const { name } = splitDemoName(site.name, site.synthetic);

  if (crews.isError) {
    return (
      <ErrorState
        title={states("error.title")}
        detail={states("error.detail")}
        onRetry={() => {
          void crews.refetch();
        }}
        requestId={crews.error.problem.request_id ?? null}
      />
    );
  }

  return (
    <section aria-labelledby="join-crews" className="flex flex-col gap-2">
      <h2 id="join-crews" className="text-base leading-(--sign-leading-text) font-medium text-ink-3">
        {t("crews")} <span className="font-normal">(<bdi>{name}</bdi>)</span>
      </h2>
      {crews.data === undefined ? (
        <RowsSkeleton />
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {crews.data.map((crew) => (
              <li key={crew.id}>
                <FieldLink href={joinHref(site.id, crew.id)} className={ROW}>
                  <span className="flex min-w-0 flex-col">
                    <bdi className="font-semibold">{crew.name}</bdi>
                    <bdi className="text-base font-normal text-ink-2">{crew.task_label}</bdi>
                  </span>
                  <Chevron />
                </FieldLink>
              </li>
            ))}
          </ul>
          <p className="text-base leading-(--sign-leading-text) text-ink-2">{t("crewMissing")}</p>
        </>
      )}
    </section>
  );
}

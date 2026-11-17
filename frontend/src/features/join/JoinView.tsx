"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import type { ApiProblem } from "@/api/problem";
import type { components } from "@/api/schema";
import { Banner } from "@/components/states/Banner";
import { ErrorState } from "@/components/states/ErrorState";
import { Skeleton } from "@/components/states/Skeletons";
import { WakingLine } from "@/components/states/WakingLine";
import { splitDemoName } from "@/components/shell/site-name";
import { ACTION_QUIET } from "@/components/states/actions";
import { DEMO_CREW_ID, pickDemoSite } from "@/features/demo/constants";
import { CrewPicker, RowsSkeleton, SitePicker } from "@/features/join/Picker";
import { StepCrew } from "@/features/join/StepCrew";
import { parseJoinLink, type JoinLink } from "@/features/join/link";
import { useSiteCrews, useSites } from "@/features/join/reads";
import { resolveCrewLink } from "@/features/join/resolve";
import { chooseDeviceSite } from "@/features/profile/choose-site";
import { useRouter } from "@/i18n/navigation";

/*
 * The worker's way in (redesign S6a, docs/design/redesign-2026-11-17/03-journeys-and-onboarding.md section 3): from a crew's link or QR
 * code (`?s=&c=`) to a confirm card, or with no code from a list of workplaces and then crews. There is no account and nothing is typed: the
 * phone remembers which site and crew it is pinned to, on the device. The page reads two public endpoints (the site list and a site's
 * crews) and pins nothing until the worker taps "Yes, this is my crew".
 *
 * Every state has a way forward: loading is a skeleton of the final height; a failed read is the error state with a retry; a code that is
 * garbled, or names a site or a crew the API does not have, says so and shows the picker beneath, never a dead end.
 *
 * "Just looking? Try the demo yard" is the one quiet way to see the app without a crew: it pins the demo site and its scored crew, the
 * same pin the old first-run button wrote, and opens Today.
 */

type Site = components["schemas"]["Site"];

/** The height of the confirm card before it is known (CLS): the site line, the rule and the crew line. */
const CARD_HEIGHT = "calc(var(--s-5) * 2 + var(--s-4) * 2 + 8.5rem)";

export function JoinSkeleton(): ReactNode {
  const states = useTranslations("states");
  return (
    <>
      <div role="status" aria-busy="true" data-join-skeleton="" className="flex flex-col gap-4">
        <Skeleton height="2.5rem" width="14rem" />
        <Skeleton height={CARD_HEIGHT} />
        <span className="sr-only">{states("loading")}</span>
      </div>
      <WakingLine />
    </>
  );
}

function LoadError({ problem, onRetry }: { readonly problem: ApiProblem; readonly onRetry: () => void }): ReactNode {
  const states = useTranslations("states");
  return <ErrorState title={states("error.title")} detail={states("error.detail")} onRetry={onRetry} requestId={problem.problem.request_id ?? null} />;
}

/** The demo yard, one quiet row: pins the demo site with its scored crew and opens Today. */
function DemoYard({ site }: { readonly site: Site | null }): ReactNode {
  const t = useTranslations("worker.join");
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  if (site === null) return null;
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => {
          chooseDeviceSite(site.id, DEMO_CREW_ID).then(
            (written) => {
              if (written) router.replace("/worker");
              else setFailed(true);
            },
            () => {
              setFailed(true);
            },
          );
        }}
        className={`${ACTION_QUIET} w-full`}
      >
        {t("demo")}
      </button>
      {failed ? (
        <p role="alert" className="px-3 text-base leading-(--sign-leading-text) text-ink">
          {t("saveFailed")}
        </p>
      ) : null}
    </div>
  );
}

/** A code that points at a crew: the confirm card, or what is wrong with the code and the picker below it. */
function CodeView({ siteId, crewId }: { readonly siteId: string; readonly crewId: string }): ReactNode {
  const t = useTranslations("worker.join");
  const sites = useSites();
  const siteKnown = sites.data?.some((site) => site.id === siteId) === true;
  const crews = useSiteCrews(siteId, siteKnown);

  const target = useMemo(() => resolveCrewLink({ siteId, crewId, sites: sites.data, crews: crews.data }), [siteId, crewId, sites.data, crews.data]);

  if (sites.error !== null) return <LoadError problem={sites.error} onRetry={sites.refetch} />;
  if (crews.error !== null) return <LoadError problem={crews.error} onRetry={crews.refetch} />;
  if (target.status === "loading") return <JoinSkeleton />;
  if (target.status === "ready") return <StepCrew site={target.site} crew={target.crew} />;

  const demoSite = pickDemoSite(sites.data ?? []);
  return (
    <>
      <h1 className="font-display text-3xl leading-(--sign-leading-display) font-semibold text-ink">{t("pageTitle")}</h1>
      <Banner>
        <p>{target.status === "unknown-site" ? t("unknownSite") : t("unknownCrew", { site: splitDemoName(target.site.name, target.site.synthetic).name })}</p>
      </Banner>
      {target.status === "unknown-crew" ? <CrewPicker site={target.site} crews={crews} /> : <SitePicker sites={sites.data ?? []} />}
      <DemoYard site={demoSite} />
    </>
  );
}

/** No usable crew in the link: the picker (a site list, or one site's crews when the link names only a site). */
function PickerView({ link }: { readonly link: JoinLink }): ReactNode {
  const t = useTranslations("worker.join");
  const sites = useSites();
  const list = sites.data;
  const named = link.kind === "site" && list !== undefined ? list.find((site) => site.id === link.siteId) : undefined;
  const crews = useSiteCrews(named?.id ?? "", named !== undefined);

  if (sites.error !== null) return <LoadError problem={sites.error} onRetry={sites.refetch} />;

  return (
    <>
      <h1 className="font-display text-3xl leading-(--sign-leading-display) font-semibold text-ink">{t("pageTitle")}</h1>
      {link.kind === "invalid" ? (
        <Banner>
          <p>{t("badCode")}</p>
        </Banner>
      ) : link.kind === "site" && list !== undefined && named === undefined ? (
        <Banner>
          <p>{t("unknownSite")}</p>
        </Banner>
      ) : null}
      {list === undefined ? <RowsSkeleton /> : named !== undefined ? <CrewPicker site={named} crews={crews} /> : <SitePicker sites={list} />}
      <DemoYard site={list === undefined ? null : pickDemoSite(list)} />
    </>
  );
}

export function JoinView(): ReactNode {
  const params = useSearchParams();
  const link = useMemo(() => parseJoinLink(params), [params]);
  return link.kind === "crew" ? <CodeView siteId={link.siteId} crewId={link.crewId} /> : <PickerView link={link} />;
}

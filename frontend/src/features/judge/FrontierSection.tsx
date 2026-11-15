import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { PendingBanner } from "@/components/states/PendingBanner";
import { Skeleton } from "@/components/states/Skeletons";
import type { FrontierSource } from "./claims";
import { FrontierHeading } from "./FrontierHeading";
import { FrontierPanel } from "./FrontierPanel";
import { DEFAULT_COMMUTE } from "./frontier-statement";
import type { RosterFrontier } from "./roster-frontier";

/**
 * The roster frontier, `#frontier` on the scoreboard. A server component: the heading and the sentence are static, the slider
 * and the chart are one client island (the commute is in the URL, which a static page cannot read on the server). The
 * island sits in its own <Suspense>, as `useSearchParams` requires on a prerendered page, with a skeleton of the final
 * height so the page does not move when it arrives.
 *
 * The legalisation gain is credited to the law here and only here (ADR 0034 section 6).
 */
export function FrontierSection({ frontier }: { readonly frontier: { readonly data: RosterFrontier; readonly source: FrontierSource } | null }) {
  const t = useTranslations("judge.frontier");
  return (
    <section id="frontier" aria-labelledby="frontier-heading" className="flex scroll-mt-4 flex-col gap-4 border-t border-hair pt-8">
      {frontier === null ? (
        <>
          <h2 id="frontier-heading" className="max-w-(--measure) font-display text-2xl font-medium">
            {t("headingPending")}
          </h2>
          <p className="max-w-(--measure) text-base text-ink-2">{t("sub")}</p>
          <PendingBanner what={t("whatPending")} />
        </>
      ) : (
        <Suspense
          fallback={
            <div className="flex flex-col gap-4">
              <FrontierHeading data={frontier.data} commute={DEFAULT_COMMUTE} />
              <FrontierSkeleton label={t("loading")} />
            </div>
          }
        >
          <FrontierPanel data={frontier.data} source={frontier.source} />
        </Suspense>
      )}
    </section>
  );
}

/**
 * The height the panel skeleton reserves (slider, chart, readouts). An estimate, NOT a measurement: the panel is about 46 rem tall at
 * 1440 px and taller on a phone, so a reader on a phone sees the page grow by the difference when the island hydrates (reported).
 */
export const FRONTIER_PANEL_HEIGHT = "46rem";

function FrontierSkeleton({ label }: { readonly label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} data-frontier-skeleton="">
      <Skeleton height={FRONTIER_PANEL_HEIGHT} />
    </div>
  );
}

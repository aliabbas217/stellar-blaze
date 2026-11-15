import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PlanSkeleton, PlanView } from "@/features/supervisor/plan/PlanView";

/*
 * The supervisor's plan for one crew, with sign-off (F2 Task 20). The page itself is the same shell for every crew: the title
 * and the skeleton are server rendered, and PlanView fills in after hydration (the day plan needs the BFF's token and the replay
 * clock reads `?at=`, so neither can be read at build time). The Suspense boundary keeps `useSearchParams` from making the
 * whole page client only.
 *
 * Rendered per request and never cached, for the reason the proof sheet gives: `dynamicParams` is on by default, so every crew id
 * a visitor tries would add a stored page for ever. The page does no work of its own (no API call), so rendering it per request
 * costs one small server render.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("supervisor.plan");
  return { title: t("pageTitle"), robots: { index: false } };
}

export default async function CrewPlanPage(props: PageProps<"/[locale]/supervisor/crews/[crewId]">) {
  const { crewId } = await props.params;
  const t = await getTranslations("supervisor.plan");
  return (
    <main className="flex flex-1 flex-col">
      <h1 className="sr-only">{t("pageTitle")}</h1>
      <Suspense fallback={<PlanSkeleton />}>
        <PlanView crewId={decodeURIComponent(crewId)} />
      </Suspense>
    </main>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { CrewsSkeleton, CrewsView } from "@/features/supervisor/CrewsView";

/*
 * The supervisor's crews screen (F2 Task 19). The page is static: the title and the skeleton are server rendered, and
 * CrewsView fills in after hydration (it reads the replay clock's `?at=`, which a static page cannot). The boundary around
 * it keeps `useSearchParams` from making the whole page client only.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("supervisor.crews");
  return { title: t("pageTitle") };
}

export default async function SupervisorPage() {
  const t = await getTranslations("supervisor");
  return (
    <main className="flex flex-1 flex-col">
      <h1 className="sr-only">{t("title")}</h1>
      <Suspense fallback={<CrewsSkeleton />}>
        <CrewsView />
      </Suspense>
    </main>
  );
}

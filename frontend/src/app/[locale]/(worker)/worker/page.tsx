import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { TodaySkeleton, TodayView } from "@/features/today/TodayView";

/*
 * The worker's Today screen (F2 Task 16). The page is static: the title and the skeleton are server rendered, and TodayView
 * fills in after hydration (it reads the phone's own storage, `?at=`, `?site=` and `?crew=`, which a static page cannot).
 * The boundary around it is what keeps `useSearchParams` from making the whole page client only.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("worker.today");
  return { title: t("title") };
}

export default async function WorkerPage() {
  const t = await getTranslations("worker.today");
  return (
    <main className="flex flex-1 flex-col">
      <h1 className="sr-only">{t("title")}</h1>
      <Suspense fallback={<TodaySkeleton />}>
        <TodayView />
      </Suspense>
    </main>
  );
}

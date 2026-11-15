import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AlertEntry } from "@/features/alert/AlertEntry";
import { AlertSkeleton } from "@/features/alert/AlertView";

/*
 * The alert card a tap on a warning opens (F2 Task 17). The notification's query says which warning it is.
 *
 * This page is STATIC on purpose (F2 W1, I3): it reads no search parameter on the server, so it is rendered at build, precached by
 * the service worker for every locale and matched there with its query ignored (features/pwa/fallback.ts, src/app/sw.ts). The
 * query is checked on the client (AlertEntry), which also opens Today for anything that is not a warning this app could have sent.
 * AlertEntry reads `?at=` (the replay clock) and the query, so it sits in its own Suspense boundary, behind the skeleton.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("worker.alert");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function AlertPage() {
  const t = await getTranslations("worker.alert");
  return (
    <main className="flex flex-1 flex-col">
      <h1 className="sr-only">{t("title")}</h1>
      <Suspense fallback={<AlertSkeleton />}>
        <AlertEntry />
      </Suspense>
    </main>
  );
}

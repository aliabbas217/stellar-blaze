import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { parseAlertParams } from "@/features/alert/alert-params";
import { AlertSkeleton, AlertView } from "@/features/alert/AlertView";

/*
 * The alert card a tap on a warning opens (F2 Task 17). The notification's query says which warning it is; it is input from
 * outside the app, so it is checked here, on the server, and anything that is not a warning this app could have sent opens
 * Today instead (a card with no identity would claim a level it cannot name). The query makes the page dynamic, which it
 * has to be: there is one card for every warning. AlertView reads `?at=` (the replay clock), so it sits in its own boundary.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("worker.alert");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function AlertPage(props: PageProps<"/[locale]/worker/alert">) {
  const [{ locale }, search] = await Promise.all([props.params, props.searchParams]);
  const params = parseAlertParams(search);
  // The [locale] layout has already refused a locale the app does not have, so the segment is safe to put back in a path.
  if (params === null) redirect(`/${locale}/worker`);

  const t = await getTranslations("worker.alert");
  return (
    <main className="flex flex-1 flex-col">
      <h1 className="sr-only">{t("title")}</h1>
      <Suspense fallback={<AlertSkeleton />}>
        <AlertView params={params} />
      </Suspense>
    </main>
  );
}

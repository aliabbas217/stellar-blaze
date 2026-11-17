import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { JoinView } from "@/features/join/JoinView";

/*
 * Join a crew (redesign S6a). The page is static: the title and a placeholder are server rendered, and JoinView fills in after hydration
 * (it reads `?s=` and `?c=`, which a static page cannot). The Suspense boundary around it keeps `useSearchParams` from making the whole
 * page client only. The heading of the page is JoinView's own (it changes with the step); until then the placeholder carries the title.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("worker.join");
  // A join link is for the phone it is sent to: it is not something to find in a search result.
  return { title: t("pageTitle"), robots: { index: false, follow: false } };
}

async function JoinFallback() {
  const t = await getTranslations("worker.join");
  return <h1 className="font-display text-3xl leading-(--sign-leading-display) font-semibold text-ink">{t("pageTitle")}</h1>;
}

export default function JoinPage() {
  return (
    <main className="flex flex-1 flex-col gap-5 px-4 pt-6 pb-8">
      <Suspense fallback={<JoinFallback />}>
        <JoinView />
      </Suspense>
    </main>
  );
}

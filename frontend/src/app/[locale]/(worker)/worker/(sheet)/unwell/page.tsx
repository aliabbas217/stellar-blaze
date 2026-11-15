import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { UnwellView } from "@/features/unwell/UnwellView";

/*
 * The "I feel unwell" call sheet (F2 Task 18). Static on purpose: no search params, no cookies, no request data, so it is
 * rendered at build, precached by the service worker for every locale (features/pwa/fallback.ts) and opens with no
 * connection. The three calls read the phone's own storage after hydration; the page itself fetches nothing and sends nothing.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("worker.unwell");
  // Nobody should land on an emergency sheet from a search result, and a stale index entry would be worse than none.
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function UnwellPage() {
  const t = await getTranslations("worker.unwell");
  return (
    <main className="flex flex-1 flex-col">
      <h1 className="sr-only">{t("title")}</h1>
      <UnwellView />
    </main>
  );
}

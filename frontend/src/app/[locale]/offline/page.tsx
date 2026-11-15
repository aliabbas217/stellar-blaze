import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// Placeholder until the offline screen is designed with the others: semantic and correct, not composed. The
// service worker precaches one copy per locale and answers any page it has not saved with it (features/pwa/fallback.ts).

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("offline");
  // Only the service worker needs this page: it must not show up in search results.
  return { title: t("title"), robots: { index: false } };
}

export default async function OfflinePage() {
  const t = await getTranslations("offline");
  return (
    <main>
      <h1>{t("title")}</h1>
      <p>{t("body")}</p>
      <Link href="/worker" className="underline">
        {t("openToday")}
      </Link>
    </main>
  );
}

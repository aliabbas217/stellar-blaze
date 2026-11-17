import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MachineTranslationNotice } from "@/components/shell/MachineTranslationNotice";
import { AlertsSettings } from "@/features/push/AlertsSettings";
import { isPushDebug, siteIdFromSearch } from "@/features/push/site";

// Functional and unstyled until the design phase composes the worker screens (architect ruling R17). It exists now
// because the real-phone Web Push spike needs it.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("alerts");
  return { title: t("title") };
}

export default async function AlertsPage(props: PageProps<"/[locale]/worker/alerts">) {
  const t = await getTranslations("alerts");
  // Reading searchParams makes this page dynamic, so the key below is read from the environment on every request:
  // one image serves every environment (no NEXT_PUBLIC_*, which Next.js would freeze into the build).
  const search = await props.searchParams;

  const configured = process.env.VAPID_PUBLIC_KEY?.trim();
  const vapidPublicKey = configured === undefined || configured === "" ? null : configured;
  if (vapidPublicKey === null) {
    console.error("VAPID_PUBLIC_KEY is not set: the Alerts page cannot turn alerts on.");
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="font-display text-2xl">{t("title")}</h1>
      <AlertsSettings vapidPublicKey={vapidPublicKey} siteId={siteIdFromSearch(search)} debug={isPushDebug(search.debug)} />
      {/* The privacy area: where the worker removes the data on this phone. One quiet line, below the content (architect ruling 2026-11-15). */}
      <MachineTranslationNotice />
    </main>
  );
}

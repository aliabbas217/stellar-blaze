import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

// Placeholder until the worker screens (Today, profile, alerts) are designed; it exists so the route does.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("worker");
  return { title: t("title") };
}

export default async function WorkerPage() {
  const t = await getTranslations("worker");
  return (
    <main>
      <h1>{t("title")}</h1>
    </main>
  );
}

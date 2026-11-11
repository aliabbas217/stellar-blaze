import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

// Placeholder until the worker screens (Today, profile, alerts) are designed; it exists so the route does.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell.roleChooser");
  return { title: t("worker.title") };
}

export default async function WorkerPage() {
  const t = await getTranslations("shell.roleChooser");
  return (
    <main>
      <h1>{t("worker.title")}</h1>
    </main>
  );
}

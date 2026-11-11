import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

// Placeholder until the HSE view is designed (its empty state links to the supervisor preview); it exists so the route does.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("title") };
}

export default async function HsePage() {
  const t = await getTranslations("hse");
  return (
    <main>
      <h1>{t("title")}</h1>
    </main>
  );
}

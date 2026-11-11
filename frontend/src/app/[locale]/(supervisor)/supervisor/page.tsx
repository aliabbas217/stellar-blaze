import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

// Placeholder until the supervisor screens (crew list, timeline) are designed; it exists so the route does.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("supervisor");
  return { title: t("title") };
}

export default async function SupervisorPage() {
  const t = await getTranslations("supervisor");
  return (
    <main>
      <h1>{t("title")}</h1>
    </main>
  );
}

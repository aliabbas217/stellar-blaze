import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RoleEntry } from "@/components/shell/RoleEntry";

/*
 * `/hse/enter`: the safety officer's role entry. Demo only: one tap, no credentials; it remembers the demo role for this browser
 * session and opens the safety view (RoleEntry.tsx).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("judge.roleEntry");
  return { title: t("officer.title") };
}

export default async function HseEnterPage() {
  const t = await getTranslations("judge.roleEntry");
  return (
    <RoleEntry
      demoRole="officer"
      href="/hse"
      title={t("officer.title")}
      sees={t("officer.sees")}
      button={t("officer.button")}
      demoAccess={t("demoAccess")}
      production={t("production")}
      change={t("change")}
    />
  );
}

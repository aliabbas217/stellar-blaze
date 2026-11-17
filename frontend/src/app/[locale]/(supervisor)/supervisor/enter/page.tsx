import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RoleEntry } from "@/components/shell/RoleEntry";

/*
 * `/supervisor/enter`: the crew lead's role entry. Demo only: one tap, no credentials; it remembers the demo role for this browser
 * session and opens the crews screen (RoleEntry.tsx). Static: the words are read at build time.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("judge.roleEntry");
  return { title: t("crew.title") };
}

export default async function SupervisorEnterPage() {
  const t = await getTranslations("judge.roleEntry");
  return (
    <RoleEntry
      demoRole="crew-lead"
      href="/supervisor"
      title={t("crew.title")}
      sees={t("crew.sees")}
      button={t("crew.button")}
      demoAccess={t("demoAccess")}
      production={t("production")}
      change={t("change")}
    />
  );
}

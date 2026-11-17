import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { DeskShell } from "@/components/shell/DeskShell";
import { ClientMessages } from "@/i18n/ClientMessages";

/*
 * The tour's shell: the desk header (wordmark and the judge menu), night only, the same as the scoreboard pages. Static: no TanStack Query
 * and no demo context. The client reads only the desk header's own copy (`common`, `shell`).
 */
export default async function TourLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("shell.desk.nav");
  const items = [
    { href: "/", label: t("story") },
    { href: "/replay", label: t("scoreboard") },
    { href: "/replay/day", label: t("day") },
    { href: "/replay/try", label: t("try") },
    { href: "/replay/governance", label: t("governance") },
    { href: "/supervisor", label: t("crews") },
  ];

  return (
    <ClientMessages paths={["_meta.review_status", "common", "shell"]}>
      <DeskShell items={items}>{children}</DeskShell>
    </ClientMessages>
  );
}

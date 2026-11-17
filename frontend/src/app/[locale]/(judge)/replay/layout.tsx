import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { DeskShell } from "@/components/shell/DeskShell";
import { ClaimsEnglish } from "@/i18n/claims-english";
import { ClientMessages } from "@/i18n/ClientMessages";

/*
 * The judge shell: the desk header (wordmark and menu), night only. Static: no TanStack Query and no demo context here,
 * so the scoreboard, day and proof pages ship neither (Task 25 budget). The two pages that mutate (`try`, `governance`)
 * sit in the `(live)` sub-layout, which adds them. Judge code must not import worker, supervisor or HSE code: see the
 * isolation rule in eslint.config.mjs.
 *
 * The pages are the claims surfaces, English by design in every catalogue (F2 Task 22): their content is a `lang="en" dir="ltr"`
 * block, the desk header above it keeps the active locale (src/i18n/claims-english.tsx).
 *
 * Typed with `children` only: no page exists under this segment yet, so `LayoutProps<"/[locale]/replay">` is not
 * generated; the view tasks add their pages and the menu links below start to resolve.
 */
export default async function ReplayLayout({ children }: { children: ReactNode }) {
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
    <ClientMessages>
      <DeskShell items={items}>
        <ClaimsEnglish>{children}</ClaimsEnglish>
      </DeskShell>
    </ClientMessages>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DeskShell } from "@/components/shell/DeskShell";
import { ResetDemoControl } from "@/components/shell/ResetDemoControl";
import { SyntheticDemoBanner } from "@/components/shell/SyntheticDemoBanner";
import { QueryProvider } from "@/providers/QueryProvider";

/*
 * Dev-only composition of the desk shell with the two demo safeguards (ADR 0062): the desk header, the "Synthetic demo
 * site" banner and the "Reset demo site" control, exactly as the action screens (Tasks 14, 15, 19, 20) will mount them.
 * The field shell is exercised by the real /worker route. Returns 404 in production unless SB_SPECIMEN=1, the one switch
 * of every dev page.
 */

export const metadata: Metadata = { title: "Shell composition", robots: { index: false, follow: false } };

export default async function ShellCompositionPage() {
  // Opt into request-time rendering so SB_SPECIMEN is read per request, not frozen at build.
  await connection();
  if (process.env.NODE_ENV === "production" && process.env.SB_SPECIMEN !== "1") notFound();

  const t = await getTranslations("shell.desk.nav");
  const items = [
    { href: "/", label: t("story") },
    { href: "/dev/shell", label: t("scoreboard") },
    { href: "/replay/day", label: t("day") },
    { href: "/replay/try", label: t("try") },
  ];

  return (
    <DeskShell items={items}>
      <QueryProvider>
        <SyntheticDemoBanner siteName="Mussafah M-14 yard (synthetic)" />
        <main className="flex flex-col gap-4 p-4 sm:p-6">
          <h1 className="font-display text-2xl">Shell composition</h1>
          <ResetDemoControl siteId="site-demo-mussafah" />
        </main>
      </QueryProvider>
    </DeskShell>
  );
}

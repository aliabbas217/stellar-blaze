import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FieldLink } from "@/components/shell/FieldLink";
import { MachineTranslationNotice } from "@/components/shell/MachineTranslationNotice";
import { SyntheticDemoBanner } from "@/components/shell/SyntheticDemoBanner";
import { ACTION_SECONDARY } from "@/components/states/actions";
import { isDemoMode } from "@/features/demo/constants";
import { DemoControls } from "./DemoControls";
import { HseView } from "./HseView";

/*
 * `/hse`: the safety officer's view, minimal and real (redesign S7, 03 section 5). The page is static server markup: the title, the privacy
 * sentence, the boundary panel and the notices are not client script (the route is held to the 170 KB budget). Only the crews table
 * (HseView: it reads the public crews of the demo site after hydration, the same read the supervisor's crews screen makes, no endpoint of
 * its own) and the closed Demo controls (DemoControls) are client code. The table shows each crew's plan (signed or not) and whether its
 * work is stopped. The weekly site-by-day table and the export are designed only: they need endpoints that do not exist (03 section 5).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("title") };
}

export default async function HsePage() {
  const t = await getTranslations("hse");
  const demo = isDemoMode();
  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-10">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-medium text-ink">{t("title")}</h1>
        <p className="max-w-(--measure) text-base text-ink-2">{t("lead")}</p>
      </header>
      {/* The site's name is in the header above: the banner here carries the notice alone. */}
      {demo ? <SyntheticDemoBanner siteName={null} /> : null}
      <HseView />
      <p data-privacy="" className="max-w-(--measure) text-base font-semibold text-ink">
        {t("privacy")}
      </p>
      <section aria-labelledby="hse-boundary" data-boundary="" className="flex flex-col items-start gap-3 rounded-card bg-panel p-4 inset-ring-[1.5px] inset-ring-edge">
        <h2 id="hse-boundary" className="font-display text-lg font-medium text-ink">
          {t("boundary.title")}
        </h2>
        <p className="max-w-(--measure) text-base text-ink-2">{t("boundary.body")}</p>
        <FieldLink href="/replay/governance" className={ACTION_SECONDARY}>
          {t("boundary.link")}
        </FieldLink>
      </section>
      {demo ? <DemoControls /> : null}
      <MachineTranslationNotice />
    </main>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HseView } from "./HseView";

/*
 * `/hse`: the safety officer's view, minimal and real (redesign S7, 03 section 5). Static: the title is server rendered, and HseView reads
 * the public crews of the demo site after hydration (the same read the supervisor's crews screen makes; no endpoint of its own). It shows
 * each crew's plan (signed or not) and whether its work is stopped, says what the service does not hold, and states the boundary.
 * The weekly site-by-day table and the export are designed only: they need endpoints that do not exist (03 section 5).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("title") };
}

export default async function HsePage() {
  const t = await getTranslations("hse");
  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-10">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-medium text-ink">{t("title")}</h1>
        <p className="max-w-(--measure) text-base text-ink-2">{t("lead")}</p>
      </header>
      <HseView />
    </main>
  );
}

import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { titleWithAppName } from "@/app/titles";
import { EvalDataError, loadEval, type EvalData } from "@/features/judge/data";
import { loadHourly } from "@/features/judge/hourly";
import { loadFieldHero } from "@/features/judge/landing/field-server";
import { LandingView } from "@/features/judge/landing/LandingView";
import { dirFor } from "@/i18n/direction";
import { ClientMessages } from "@/i18n/ClientMessages";
import { routing } from "@/i18n/routing";

/*
 * `/<locale>`: the landing page, the first frame of the story. Static: it reads the recorded forecast files and the scored
 * files at build time and makes no API call, so it renders the same with the API stopped. The only client code at first load is
 * the proof chip and the gate that brings the field in after first paint (features/judge/landing/FieldGate.tsx); the field, its
 * data and (later) the WebGL scene load after that, on this route only. The role chooser of the first phase is gone: the apps
 * are linked from the foot of the page.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("judge.landing");
  const common = await getTranslations("common");
  // The layout's title template reaches its child segments, not this page beside it: add the app name here.
  return { title: titleWithAppName(t("metaTitle"), common("appName")) };
}

export default async function LocaleHomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  let data: EvalData | null = null;
  try {
    data = await loadEval();
  } catch (error) {
    // A scored file that cannot be read drops the scored parts of the landing (the hook and the table); a release build must not ship that.
    if (!(error instanceof EvalDataError) || process.env.SB_REQUIRE_SCORED === "1") throw error;
    console.error(`landing: ${error.message}`);
  }
  const hourly = await loadHourly();
  const field = await loadFieldHero(hourly);

  return (
    // The client reads: the proof chip and its drawer, the spine's slot label, the field island's own strings.
    <ClientMessages paths={["judge.landing", "judge.story", "states.proof", "judge.proof", "common.spine"]}>
      <LandingView field={field} hourly={hourly} data={data} dir={dirFor(locale)} />
    </ClientMessages>
  );
}

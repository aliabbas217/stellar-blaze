import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EvalDataError, loadEval, type EvalData } from "@/features/judge/data";
import { DayView } from "@/features/judge/DayView";
import { loadHourly } from "@/features/judge/hourly";

/*
 * `/replay/day`: one day, hour by hour. Static: it reads the scored day file (when the scoring run has written one) and the
 * recorded hourly forecast at build time and ships no API call, so it renders the same with the API stopped.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("judge.day");
  // Neutral: the rule claim ("chosen by a rule before we looked") belongs to the scored page, and a document title cannot know the state.
  return { title: t("titlePending") };
}

export default async function DayPage() {
  let data: EvalData | null = null;
  let failed = false;
  try {
    data = await loadEval();
  } catch (error) {
    // A day file that exists but cannot be read is a plain message under the recorded chart, never a guessed number. A
    // release build (SB_REQUIRE_SCORED=1) must not ship that: it fails here instead.
    if (!(error instanceof EvalDataError) || process.env.SB_REQUIRE_SCORED === "1") throw error;
    console.error(`day: ${error.message}`);
    failed = true;
  }
  return <DayView data={data} failed={failed} hourly={await loadHourly()} />;
}

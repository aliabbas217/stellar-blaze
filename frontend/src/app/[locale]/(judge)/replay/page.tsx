import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DATA_MANIFEST } from "@/features/judge/manifest.generated";
import { EvalDataError, loadEval, type EvalData } from "@/features/judge/data";
import { loadHourly } from "@/features/judge/hourly";
import { ScoreboardView } from "@/features/judge/ScoreboardView";

/*
 * `/replay`: the season scoreboard. Static: it reads three exporter files and two recorded files at build time and ships
 * no API call, so it renders the same with the API stopped. The only client islands are the season player, the frontier
 * slider and the proof drawer.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("judge.scoreboard");
  return { title: t("title") };
}

const FRONTIER_FILE = "static/roster_frontier.json" as const;

export default async function ReplayPage() {
  let data: EvalData | null = null;
  let failed = false;
  try {
    data = await loadEval();
  } catch (error) {
    // A scored file that exists but cannot be read is shown as a plain message under the static season, never as a number.
    // A release build (SB_REQUIRE_SCORED=1) must not ship that: it fails here instead.
    if (!(error instanceof EvalDataError) || process.env.SB_REQUIRE_SCORED === "1") throw error;
    console.error(`replay: ${error.message}`);
    failed = true;
  }
  const hourly = await loadHourly();
  const frontier = DATA_MANIFEST[FRONTIER_FILE];

  return <ScoreboardView data={data} failed={failed} hourly={hourly} frontierSource={{ label: frontier.label, protocol: frontier.source }} />;
}

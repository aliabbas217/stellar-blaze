import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GovernanceView } from "@/features/judge/governance/GovernanceView";
import { loadRecordedRun } from "@/features/judge/governance/load-recorded";

/*
 * `/replay/governance`: the governance refusal. The recorded run is read at build time and drawn at first paint; the live
 * call, the live log and the demo reset are client code under the `(live)` layout (TanStack Query and the demo context).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("judge.governance");
  return { title: t("eyebrow") };
}

export default async function GovernancePage() {
  return <GovernanceView recorded={await loadRecordedRun()} />;
}

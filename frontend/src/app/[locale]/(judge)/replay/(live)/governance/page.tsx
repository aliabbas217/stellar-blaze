import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GovernanceGate } from "@/features/judge/governance/GovernanceGate";
import { GovernanceStatic } from "@/features/judge/governance/GovernanceStatic";
import { loadRecordedRun } from "@/features/judge/governance/load-recorded";

/*
 * `/replay/governance`: the governance refusal. The recorded run is read at build time and server-rendered (`GovernanceStatic`),
 * so first paint is complete without TanStack Query or the demo context. The live call, the live log and the demo reset are the
 * interactive island, fetched on the first tap or focus on a control (`GovernanceGate`) and never before.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("judge.governance");
  return { title: t("eyebrow") };
}

export default async function GovernancePage() {
  const recorded = await loadRecordedRun();
  return (
    <GovernanceGate recorded={recorded}>
      <GovernanceStatic recorded={recorded} />
    </GovernanceGate>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { Pictogram } from "@/components/level/Pictogram";
import type { Lead } from "@/features/today/action-codes";

/**
 * What to do now, in one line: a verb and its numbers (22 px), from the hour's action codes. With no level to act on
 * (`protective`) it is the fixed site rules; with a code nobody has mapped it is "Follow the site rules". The whole lead is
 * marked as draft wording: the clinical review of the action text is not done, and a worker is told so beside the line itself.
 * When the level on the sign is last known, not live, the stale banner above says "No fresh forecast: protective plan" (B3's
 * wording for a stale or missing forecast), so the rules below it read as that plan.
 */
export function ActionLead({ lead, protective }: { readonly lead: Lead; readonly protective: boolean }) {
  const t = useTranslations("worker.today");
  const text = protective
    ? t("lead.protective")
    : lead.kind === "cycle"
      ? t("lead.cycle", { work: String(lead.workMinutes), rest: String(lead.restMinutes) })
      : t(`lead.${lead.kind}`);

  return (
    <section aria-label={text} className="flex flex-col gap-2 px-4">
      <p data-action-lead="" className="grid grid-cols-[2.5rem_1fr] items-center gap-3 text-xl leading-(--sign-leading-text) font-medium text-ink [&:lang(ar)]:text-lg [&:lang(ur)]:text-lg">
        <Pictogram name="shade" className="size-10" />
        <span>{text}</span>
      </p>
      <p className="text-base leading-(--sign-leading-text) text-ink-2">{t("draftWording")}</p>
    </section>
  );
}

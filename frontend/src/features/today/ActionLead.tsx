"use client";

import { useTranslations } from "next-intl";
import { Pictogram } from "@/components/level/Pictogram";
import type { Lead } from "@/features/today/action-codes";

/**
 * What to do now, in one sentence: a verb and its numbers (28 px, the largest text of the screen), from the hour's action codes,
 * with the shade pictogram. With no level to act on (`protective`) it is the fixed site rules; with a code nobody has mapped it is
 * "Follow the site rules". The sentence is the FIRST thing of the level card (redesign 04, section 3.1): the worker's question is
 * "what do I do?", and the level is the second answer.
 *
 * The clinical note is not printed here: the screen carries it ONCE, beside "Why <level>?" (TodayView.tsx, decision D5), and covers
 * this sentence and the list. When the level on the sign is last known, not live, the stale banner above says "No fresh forecast:
 * protective plan" (B3's wording for a stale or missing forecast), so the rules below it read as that plan.
 *
 * `className` is the section's gutter: `px-4` on the page, none inside the level card (which pads itself).
 */
export function ActionLead({ lead, protective, className = "px-4" }: { readonly lead: Lead; readonly protective: boolean; readonly className?: string }) {
  const t = useTranslations("worker.today");
  const text = protective
    ? t("lead.protective")
    : lead.kind === "cycle"
      ? t("lead.cycle", { work: String(lead.workMinutes), rest: String(lead.restMinutes) })
      : t(`lead.${lead.kind}`);

  return (
    <section aria-label={text} className={className}>
      <p
        data-action-lead=""
        className="grid grid-cols-[2.75rem_1fr] items-center gap-3 text-(length:--t-28) leading-(--sign-leading-display) font-semibold text-ink [&:lang(ar)]:text-(length:--t-24) [&:lang(ur)]:text-(length:--t-24)"
      >
        <Pictogram name="shade" className="size-11" />
        <span>{text}</span>
      </p>
    </section>
  );
}

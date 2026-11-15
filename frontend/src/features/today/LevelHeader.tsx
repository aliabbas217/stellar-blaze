"use client";

import { useTranslations } from "next-intl";
import { ViewTransition } from "react";
import { LevelSign } from "@/components/level/LevelSign";
import type { TodayDescription } from "@/features/today/describe";
import { useTimeFormat } from "@/features/today/labels";
import "@/styles/view-transitions.css";

/**
 * The level sign of Today: the word at 76 px, how long it holds, and the four-step scale. A stale, offline or fallback sign is
 * drawn as such by LevelSign (clock, dimmer word, dashed marker), never as a live one. The shared view-transition name
 * `level` pairs it with the alert card's sign. A worker whose own level is higher is told so under it: the sign leads with
 * the more severe of the two, and says whose it is in the kicker.
 */
export function LevelHeader({ description }: { readonly description: TodayDescription }) {
  const t = useTranslations("worker.today");
  const time = useTimeFormat();
  const { level, levelKind, kicker, untilAt, personalHigher } = description;

  return (
    <ViewTransition name="level" share="morph" default="none">
      <section aria-label={t(`kicker.${kicker}`)} className="flex flex-col gap-3 px-4">
        <LevelSign
          level={level}
          kind={levelKind}
          size="hero"
          kicker={t(`kicker.${kicker}`)}
          {...(untilAt === null ? {} : { until: t.rich("until", { time: time(untilAt), bdi: (chunks) => <bdi>{chunks}</bdi> }) })}
        />
        {personalHigher ? <p className="text-lg font-medium text-ink">{t("personalHigher")}</p> : null}
      </section>
    </ViewTransition>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { ViewTransition } from "react";
import type { components } from "@/api/schema";
import { LevelSign } from "@/components/level/LevelSign";
import { ModeStamp } from "@/components/provenance/ModeStamp";
import type { TodayDescription } from "@/features/today/describe";
import { useTimeFormat } from "@/features/today/labels";
import "@/styles/view-transitions.css";

/**
 * The level sign of Today: the word at 76 px, how long it holds, and the four-step scale. A stale, offline or fallback sign is
 * drawn as such by LevelSign (clock, dimmer word, dashed marker), never as a live one. The shared view-transition name
 * `level` pairs it with the alert card's sign. A worker whose own level is higher is told so under it: the sign leads with
 * the more severe of the two, and says whose it is in the kicker.
 */
export function LevelHeader({
  description,
  mode,
}: {
  readonly description: TodayDescription;
  /** The API's own mode for this forecast: a replayed day carries the Replay stamp on the sign's kicker line (review focus 6). */
  readonly mode: components["schemas"]["SiteForecastToday"]["mode"];
}) {
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
          stamp={<ModeStamp mode={mode} />}
          {...(untilAt === null ? {} : { until: t.rich("until", { time: time(untilAt), bdi: (chunks) => <bdi>{chunks}</bdi> }) })}
        />
        {personalHigher ? <p className="text-lg font-medium text-ink">{t("personalHigher")}</p> : null}
      </section>
    </ViewTransition>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { ViewTransition, type ReactNode } from "react";
import type { components } from "@/api/schema";
import { LevelSign } from "@/components/level/LevelSign";
import { ModeStamp } from "@/components/provenance/ModeStamp";
import type { TodayDescription } from "@/features/today/describe";
import { useTimeFormat } from "@/features/today/labels";
import "@/styles/view-transitions.css";

/**
 * The level row of Today: the word at 32 px with its 14 px mark, how long it holds, and the four-step scale. A stale, offline or
 * fallback sign is drawn as such by LevelSign (clock, dimmer word, dashed marker), never as a live one. The shared view-transition
 * name `level` pairs it with the alert card's sign. A worker whose own level is higher is told so under it: the sign leads with
 * the more severe of the two, and says whose it is in the kicker.
 *
 * `className` is the section's gutter: `px-4` on the page, none inside the level card (which pads itself).
 */
export function LevelHeader({
  description,
  mode,
  className = "px-4",
  action,
}: {
  readonly description: TodayDescription;
  /** The API's own mode for this forecast: a replayed day carries the Replay stamp on the sign's kicker line (review focus 6). */
  readonly mode: components["schemas"]["SiteForecastToday"]["mode"];
  readonly className?: string;
  /** The control of this level ("Why Orange?"), set on the word's row (LevelSign `action`): inside the hero, never at the foot of the page. */
  readonly action?: ReactNode;
}) {
  const t = useTranslations("worker.today");
  const time = useTimeFormat();
  const { level, levelKind, kicker, untilAt, personalHigher } = description;

  return (
    <ViewTransition name="level" share="morph" default="none">
      <section aria-label={t(`kicker.${kicker}`)} className={`flex flex-col gap-3 ${className}`}>
        <LevelSign
          level={level}
          kind={levelKind}
          size="hero"
          kicker={t(`kicker.${kicker}`)}
          stamp={<ModeStamp mode={mode} />}
          {...(action === undefined ? {} : { action })}
          {...(untilAt === null ? {} : { until: t.rich("until", { time: time(untilAt), bdi: (chunks) => <bdi>{chunks}</bdi> }) })}
        />
        {personalHigher ? <p className="text-lg font-medium text-ink">{t("personalHigher")}</p> : null}
      </section>
    </ViewTransition>
  );
}

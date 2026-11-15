"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatClock } from "@/components/spine/geometry";
import { TimeSpine, type SpineWaypoint } from "@/components/spine/TimeSpine";
import type { TodayDescription } from "@/features/today/describe";
import { isolateTime, useAgeLabel } from "@/features/today/labels";
import { formatMonthDay } from "@/features/today/schedule";
import { dirFor } from "@/i18n/direction";

/*
 * The hero of Today: the shift as a vertical time spine (the heat level in each hour's cell, the recessed slot only where the
 * midday break is in force, the line at now), with the waypoints worded. The spine is the biggest thing on the screen on
 * purpose (`data-hero`: at least 35 % of the first fold, the design gate) while the forecast is live. In a not-live state the
 * protective-plan lead above it is the hero (ProtectiveLead.tsx) and the spine keeps its place without the attribute.
 */

/** One text row of the spine, as TimeSpine sets it (the 16 px field label at the locale's line height). */
const SPINE_ROW = "calc(var(--t-16) * var(--sign-leading-text, var(--leading-body)))";

/** The height of a spine of `hours` hours: two rows per hour plus the one the last waypoint hangs into, and its top padding. */
export function spineHeight(hours: number): string {
  return `calc(${SPINE_ROW} * ${String(hours * 2 + 1)} + var(--s-3))`;
}

export function ShiftSpine({ description }: { readonly description: TodayDescription }) {
  const t = useTranslations("worker.today.spine");
  const heading = useTranslations("today.band")("heading");
  const locale = useLocale();
  const ageLabel = useAgeLabel();
  const { from, to, ban, banNote } = description;

  // Where the break is not in force there is no slot and the day says why, in words: after the season, "after 15 Sep"; before
  // it, "until 15 Jun". The dates are the API's `ban_window`, never a literal.
  const noBreak =
    banNote === null
      ? undefined
      : banNote.phase === "after"
        ? t("noBreakAfter", { date: formatMonthDay(banNote.seasonEnd, locale) })
        : banNote.resumes === null
          ? undefined
          : t("noBreakUntil", { date: banNote.resumes });

  const waypoints = description.waypoints.map((spec): SpineWaypoint => {
    switch (spec.kind) {
      case "now":
        return { at: spec.at, title: t("now") };
      case "breakIn":
        return { at: spec.at, title: t("breakIn", { duration: ageLabel(spec.minutes * 60_000) }) };
      case "backToWork":
        return { at: spec.at, title: t("backToWork", { time: isolateTime(formatClock(spec.at)) }) };
      case "shiftEnds":
        return { at: spec.at, title: t("shiftEnds", { time: isolateTime(formatClock(spec.at)) }) };
      case "noBreak":
        return noBreak === undefined ? { at: spec.at } : { at: spec.at, detail: noBreak };
    }
  });

  const spoken = waypoints
    .map((waypoint) => [waypoint.title, waypoint.detail].filter((part) => part !== undefined).join(", "))
    .filter((part) => part !== "")
    .join(". ");
  const aria = t("aria", { from: formatClock(from), to: formatClock(to), waypoints: spoken });

  return (
    <section {...(description.notLive ? {} : { "data-hero": "" })} aria-label={heading} className="px-2">
      <TimeSpine
        orientation="v"
        surface="field"
        dir={dirFor(locale)}
        from={from}
        to={to}
        cells={description.cells}
        now={description.nowHour}
        ban={ban}
        waypoints={waypoints}
        aria={aria}
      />
    </section>
  );
}

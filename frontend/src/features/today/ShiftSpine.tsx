"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatClock } from "@/components/spine/geometry";
import { TimeSpine, type SpineWaypoint } from "@/components/spine/TimeSpine";
import type { TodayDescription } from "@/features/today/describe";
import { isolateTime, useAgeLabel } from "@/features/today/labels";
import { formatMonthDay } from "@/features/today/schedule";
import { dirFor } from "@/i18n/direction";

/*
 * The shift of Today as one horizontal strip across the full width of the phone (redesign S5, 04 section 3.2): the heat level in
 * each hour's cell, the recessed slot only where the midday break is in force, the line at now with its label above it, the hour
 * ticks below. In Arabic and Urdu the strip mirrors (time flows in the reading direction, as TimeSpine does).
 *
 * Only "Now" is drawn on the strip; the rest of the day's waypoints (the break, back to work, the shift's end, or why there is no
 * break) are ONE plain line under it, so the strip stays as short as the horizontal spine is and the line reads in one glance.
 * The spoken description (the image's accessible name) still carries every waypoint. The slot's own label is off: the line says when the
 * break starts and ends, and the recessed slot is still drawn where the break is in force.
 *
 * The strip is the second half of the hero while the forecast is live (TodayView puts `data-hero` around the level card and this
 * strip together). In a not-live state the protective-plan lead above is the hero (ProtectiveLead.tsx) and the strip keeps its place.
 */

/** One text row of the strip (the 16 px field label at the locale's line height). */
const ROW = "calc(var(--t-16) * var(--sign-leading-text, var(--leading-body)))";

/** A 14 px line (the strip's heading and its plain line) at the locale's line height. */
const SMALL_ROW = "var(--t-14) * var(--sign-leading-text, var(--leading-body))";

/**
 * The height the strip reserves while the forecast loads: the heading line, the spine (its padding, the "Now" row, the band with its
 * overhang, the tick row) and the one plain line, with the gaps between them. A line
 * that wraps still grows it past this floor, as in every sign of the screen.
 */
export const SHIFT_STRIP_HEIGHT =
  `calc(${SMALL_ROW} * 2 + ${ROW} + var(--s-12) + var(--s-3) * 4 + var(--t-16) * 1.5 + var(--s-2) * 2 + var(--s-1))` as const;

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

  const all = description.waypoints.map((spec): SpineWaypoint & { readonly kind: (typeof description.waypoints)[number]["kind"] } => {
    switch (spec.kind) {
      case "now":
        return { kind: spec.kind, at: spec.at, title: t("now") };
      case "breakIn":
        return { kind: spec.kind, at: spec.at, title: t("breakIn", { duration: ageLabel(spec.minutes * 60_000) }) };
      case "backToWork":
        return { kind: spec.kind, at: spec.at, title: t("backToWork", { time: isolateTime(formatClock(spec.at)) }) };
      case "shiftEnds":
        return { kind: spec.kind, at: spec.at, title: t("shiftEnds", { time: isolateTime(formatClock(spec.at)) }) };
      case "noBreak":
        return noBreak === undefined ? { kind: spec.kind, at: spec.at } : { kind: spec.kind, at: spec.at, detail: noBreak };
    }
  });

  const spoken = all
    .map((waypoint) => [waypoint.title, waypoint.detail].filter((part) => part !== undefined).join(", "))
    .filter((part) => part !== "")
    .join(". ");
  const aria = t("aria", { from: formatClock(from), to: formatClock(to), waypoints: spoken });

  // The strip carries "Now" alone; everything else is the line under it, as separate phrases (no punctuation to localise).
  const onStrip = all.filter((waypoint) => waypoint.kind === "now").map(({ at, title }): SpineWaypoint => (title === undefined ? { at } : { at, title }));
  const line = all
    .filter((waypoint) => waypoint.kind !== "now")
    .map((waypoint) => waypoint.title ?? waypoint.detail)
    .filter((phrase): phrase is string => phrase !== undefined);

  return (
    <section aria-labelledby="shift-strip" className="flex flex-col">
      <h2 id="shift-strip" className="px-4 text-sm leading-(--sign-leading-text) font-medium text-ink-3">
        {heading}
      </h2>
      <TimeSpine
        orientation="h"
        surface="field"
        dir={dirFor(locale)}
        from={from}
        to={to}
        cells={description.cells}
        now={description.nowHour}
        ban={ban}
        waypoints={onStrip}
        aria={aria}
        slotLabel={false}
      />
      {line.length === 0 ? null : (
        <p data-shift-line="" className="mt-1 flex flex-wrap gap-x-3 px-4 text-sm leading-(--sign-leading-text) text-ink-2">
          {line.map((phrase) => (
            <span key={phrase}>{phrase}</span>
          ))}
        </p>
      )}
    </section>
  );
}

"use client";

import { useTranslations } from "next-intl";
import type { components } from "@/api/schema";
import { LevelSign } from "@/components/level/LevelSign";
import { levelIndex } from "@/components/level/level";
import { ActionLead } from "@/features/today/ActionLead";
import { PROTECTIVE_LEVEL, type TodayDescription } from "@/features/today/describe";
import { LevelHeader } from "@/features/today/LevelHeader";
import { useAgeLabel, useTimeFormat } from "@/features/today/labels";

/**
 * The hero of Today when there is no live forecast (stale, offline or fallback; F2 W3.2, architect ruling b): the protective-plan
 * lead. It is the FIRST text of the screen and it is always rendered in those three states, in every language, so a worker who
 * opens the app with no signal reads the plan the app can stand behind before anything else:
 *
 *   "No fresh forecast: protective plan", then (offline only) why, then the site rules, then the level that plan uses (High, drawn
 *   dashed as a level that is not a live reading), then the level the forecast last gave, secondary and dashed, with when it was
 *   written.
 *
 * Its heading is 36 px, 28 px in Arabic and Urdu: their line height is 2.5 (Nastaliq clips below about 2) and three lines at 36 px (270 px)
 * pushed the site rules under the worker dock in the first fold at 390 x 844; at 28 px they sit above it. The hero floor holds with room.
 *
 * It carries `data-hero`: the design gate's 35 % floor of the first fold is asserted on THIS element in all six locales (the
 * spine, which stays on screen below it, is the hero only while the forecast is live). Nothing below the heading is drawn from the
 * forecast as current: no heat colour, no line at now, no "until" (describe.ts).
 */
export function ProtectiveLead({
  description,
  mode,
  updatedAt,
  ageMs,
  offline,
}: {
  readonly description: TodayDescription;
  readonly mode: components["schemas"]["SiteForecastToday"]["mode"];
  /** When the forecast on screen was written, or null when there is none to say (a fallback forecast). */
  readonly updatedAt: Date | null;
  readonly ageMs: number | null;
  /** The phone has no connection (said in words under the heading). */
  readonly offline: boolean;
}) {
  const t = useTranslations("worker.today");
  const offlineWords = useTranslations("states.offlineBanner");
  const time = useTimeFormat();
  const ageLabel = useAgeLabel();
  const levels = useTranslations("levels");
  const { lastKnownLevel } = description;
  // The protective plan is High (Orange). When the last known level was ABOVE it (Red: a stop level), the plan the sign shows is
  // not the worst the forecast last said, and the lead says so in words (F2 W4 I5, interim until the architect rules).
  const lastKnownHigher = lastKnownLevel !== null && levelIndex(lastKnownLevel) > levelIndex(PROTECTIVE_LEVEL) ? lastKnownLevel : null;

  return (
    <section data-hero="" data-protective-lead="" aria-labelledby="protective-lead" className="flex flex-col gap-3 pt-3">
      {/* A polite live region: the screen changing to a protective plan (the signal went, the forecast aged) is announced. */}
      <div role="status" className="flex flex-col gap-2 px-4">
        <h2
          id="protective-lead"
          className="font-display text-4xl leading-(--sign-leading-word) font-medium tracking-display text-ink [&:lang(ar)]:text-(length:--t-28) [&:lang(ur)]:text-(length:--t-28)"
        >
          {t("kicker.fallback")}
        </h2>
        {lastKnownHigher === null ? null : (
          <p data-last-known-higher="" className="text-lg font-semibold leading-(--sign-leading-text) text-ink">
            {t.rich("kicker.lastKnownHigher", { level: levels(`name.${lastKnownHigher}`), bdi: (chunks) => <bdi>{chunks}</bdi> })}
          </p>
        )}
        {offline ? (
          <p className="text-lg leading-(--sign-leading-text) text-ink-2">
            <strong className="block font-medium text-ink">{offlineWords("title")}</strong>
            {offlineWords("body")}
          </p>
        ) : null}
      </div>
      <ActionLead lead={description.plan.lead} protective />
      <LevelHeader description={description} mode={mode} />
      {updatedAt === null || ageMs === null ? null : (
        <div className="flex flex-col gap-2 px-4">
          {lastKnownLevel === null ? null : (
            <LevelSign level={lastKnownLevel} kind="stale" size="mini" kicker={t("kicker.stale")} />
          )}
          <p className="text-base leading-(--sign-leading-text) text-ink-2">
            {offlineWords.rich("lastKnown", { time: time(updatedAt), age: ageLabel(ageMs), bdi: (chunks) => <bdi>{chunks}</bdi> })}
          </p>
        </div>
      )}
    </section>
  );
}

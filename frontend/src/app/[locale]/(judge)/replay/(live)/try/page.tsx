import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { dayFormat } from "@/components/charts/day-format";
import { REPLAY_DATE } from "@/features/demo/constants";
import { banStateFor, SEASON_BAN } from "@/features/judge/ban";
import { loadHourly } from "@/features/judge/hourly";
import { heatColor } from "@/lib/heat/ramp";
import { loadRecordedPlan } from "@/features/judge/validator/recorded-plan";
import { TryGate } from "@/features/judge/validator/TryGate";
import { TryStatic } from "@/features/judge/validator/TryStatic";

/*
 * `/replay/try`: check a plan against the independent validator. The first paint is server-rendered from build-time files (the
 * replay day's recorded forecast for the heat behind the plan, the recorded validator result for the error state) and calls no API;
 * the check itself, the demo site and TanStack Query are the interactive island, fetched on the first tap or focus on a control
 * (`TryGate`) and never before.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("judge.try");
  return { title: t("title") };
}

export default async function TryPage() {
  const locale = await getLocale();
  const [hourly, recorded] = await Promise.all([loadHourly(), loadRecordedPlan()]);
  const at = hourly.series.days.indexOf(REPLAY_DATE);
  const row = at < 0 ? [] : (hourly.series.wbgt_c_by_local_hour[at] ?? []);
  // The raw forecast of the replay day, one colour per local hour (heat colour on data only; the judge routes are night only).
  const heat = Array.from({ length: 24 }, (_, hour) => {
    const value = row[hour];
    return value === null || value === undefined ? null : heatColor(value, "night");
  });
  const ban = banStateFor(SEASON_BAN, REPLAY_DATE, locale);
  const dateLabel = dayFormat(locale).withWeekday(REPLAY_DATE);
  return (
    <TryGate heat={heat} ban={ban} dateLabel={dateLabel} recorded={recorded}>
      <TryStatic heat={heat} ban={ban} dateLabel={dateLabel} recorded={recorded} />
    </TryGate>
  );
}

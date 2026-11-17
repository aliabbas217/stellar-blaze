"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { ageParts } from "@/features/today/schedule";

/*
 * The two words-with-numbers every Today piece needs: a clock time and an age. Both are Western digits in every language
 * (numbers are passed as strings, never as numbers a locale could re-digit) and a time is in the provider's zone, the site's.
 */

export { useTimeFormat } from "@/lib/time/use-time-format";

/** "1 h 30 min", "26 h", "45 min": the age of something, from milliseconds. */
export function useAgeLabel(): (ms: number) => string {
  const t = useTranslations("worker.today.age");
  return useCallback(
    (ms: number) => {
      const { hours, minutes } = ageParts(ms);
      const values = { hours: String(hours), minutes: String(minutes) };
      if (hours === 0) return t("minutes", values);
      return minutes === 0 ? t("hours", values) : t("hoursMinutes", values);
    },
    [t],
  );
}

/** A time wrapped in a left-to-right isolate, for a string (a waypoint's title) that is placed inside right-to-left text. */
export function isolateTime(time: string): string {
  return `⁦${time}⁩`;
}

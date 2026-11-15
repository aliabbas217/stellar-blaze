"use client";

import { useFormatter } from "next-intl";
import { useCallback } from "react";

/** `HH:MM`, 24-hour, in the provider's zone (the site's), Western digits in every language: the same options as the header clock. */
export function useTimeFormat(): (at: Date) => string {
  const format = useFormatter();
  return useCallback(
    (at: Date) => format.dateTime(at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", numberingSystem: "latn" }),
    [format],
  );
}

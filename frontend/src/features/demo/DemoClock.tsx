"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Suspense } from "react";
import { useClock } from "@/features/demo/useClock";

function ClockText() {
  const format = useFormatter();
  const now = useClock();
  // 24-hour, Western digits in every language, in the site's zone (the provider's `timeZone`): the same options as the
  // named "time" format of src/i18n/request.ts, written out so the client provider needs no `formats`.
  return <>{format.dateTime(now, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", numberingSystem: "latn" })}</>;
}

/**
 * The demo clock as text, for a header. It reads `?at=`, which on a statically rendered page needs its own <Suspense>
 * boundary, so the boundary is here: the page around it stays server-rendered and the clock fills in after hydration.
 */
export function DemoClock() {
  const t = useTranslations("shell.field");
  return (
    <Suspense fallback={t("pendingClock")}>
      <ClockText />
    </Suspense>
  );
}

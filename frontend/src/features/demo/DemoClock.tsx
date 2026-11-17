"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Suspense, useSyncExternalStore } from "react";
import { useClock } from "@/features/demo/useClock";

function ClockText() {
  const t = useTranslations("shell.field");
  const format = useFormatter();
  const now = useClock();
  // No time is known until the API's clock has answered: the same "not yet" reading as before hydration, never a guessed time.
  if (now === null) return t("pendingClock");
  // 24-hour, Western digits in every language, in the site's zone (the provider's `timeZone`): the same options as the
  // named "time" format of src/i18n/request.ts, written out so the client provider needs no `formats`.
  return <>{format.dateTime(now, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", numberingSystem: "latn" })}</>;
}

const noSubscription = (): (() => void) => () => undefined;

/** False on the server and during hydration, true once the browser has taken the page over (the same snapshot discipline as SunToggle). */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/**
 * The demo clock as text, for a header. It reads `?at=`, which on a statically rendered page needs its own <Suspense>
 * boundary, so the boundary is here: the page around it stays server-rendered and the clock fills in after hydration.
 *
 * A page rendered per request (the supervisor plan is `force-dynamic`) does render the clock on the server, and the server's
 * clock is never the browser's: a device a minute off, or a page that took a minute to hydrate, reads another HH:MM and React
 * reports #418 and re-renders the whole root. So the server and the first client render both draw the "not yet" reading, and the
 * time (the API's clock in replay mode, or the device clock) fills in right after, once a forecast has said which it is. Not `suppressHydrationWarning`: the mismatch is avoided,
 * not hidden, and the server's reading was never the right one in replay mode anyway (the replay time comes from the API's own clock).
 */
export function DemoClock() {
  const t = useTranslations("shell.field");
  const hydrated = useHydrated();
  if (!hydrated) return t("pendingClock");
  return (
    <Suspense fallback={t("pendingClock")}>
      <ClockText />
    </Suspense>
  );
}

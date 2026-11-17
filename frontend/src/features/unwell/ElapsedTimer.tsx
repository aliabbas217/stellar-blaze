"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { formatElapsed, RULER_MINUTES, rulerFraction, tapTime } from "@/features/unwell/elapsed";

/*
 * The time since the worker opened the sheet, and a ten-minute ruler from "Tap" to "10 min". It starts when the sheet
 * hydrates (the tap is the open), is kept in sessionStorage so a reload keeps counting, and is never sent anywhere: it reads
 * the clock and one storage key and does nothing else. Until the phone has said when the tap was, it shows 0:00 and an
 * empty ruler, the same as the server rendered, so nothing jumps.
 *
 * The ruler is drawn with logical properties, so in Urdu and Arabic it fills from the right; the clock time and the minute
 * counts stay Western digits (the message formats say so).
 */

const TICK_MS = 1000;
/** Where the ruler's labels sit: at the tap, halfway and at the end. Ticks every two minutes carry no label. */
const TICKS = Array.from({ length: RULER_MINUTES / 2 + 1 }, (_, index) => index * 2);

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** When the tap was and what time it is, read together so the two never disagree. `null` until the phone has been asked. */
interface Reading {
  readonly tap: number;
  readonly now: number;
}

// The clock is an external system, so it is read through useSyncExternalStore: the first reading happens when the component
// subscribes (the tap is the open), and it ticks once a second. Nothing but the clock and one sessionStorage key is touched.
let reading: Reading | null = null;

function subscribe(onChange: () => void): () => void {
  const tap = tapTime(Date.now(), sessionStorageOrNull());
  const read = () => {
    reading = { tap, now: Date.now() };
    onChange();
  };
  read();
  const timer = setInterval(read, TICK_MS);
  // A phone asleep in a pocket throttles timers: read the clock again as soon as the screen is back.
  document.addEventListener("visibilitychange", read);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", read);
    reading = null;
  };
}

function useReading(): Reading | null {
  return useSyncExternalStore(
    subscribe,
    () => reading,
    () => null,
  );
}

export function ElapsedTimer() {
  const t = useTranslations("worker.unwell.timer");
  const format = useFormatter();
  const current = useReading();
  const tap = current?.tap ?? null;

  const elapsed = current === null ? 0 : current.now - current.tap;
  const fraction = rulerFraction(elapsed);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-h-6 text-base leading-(--sign-leading-text) font-medium text-ink-2">
          {tap === null
            ? null
            : t.rich("tappedAt", {
                time: format.dateTime(tap, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", numberingSystem: "latn" }),
                bdi: (chunks) => <bdi className="text-ink">{chunks}</bdi>,
              })}
        </p>
        <p
          role="timer"
          aria-live="off"
          aria-label={t("elapsed")}
          dir="ltr"
          className="font-display text-5xl leading-none font-medium tracking-tight text-ink tabular-nums"
        >
          {formatElapsed(elapsed)}
        </p>
      </div>
      <div aria-hidden="true" className="flex flex-col gap-1">
        <div className="relative h-3">
          <div className="absolute inset-x-0 top-1 h-1.5 bg-hair" />
          <div className="absolute inset-y-0 start-0 bg-ink" style={{ width: `max(2px, ${String(fraction * 100)}%)` }} />
          {TICKS.map((minute) => (
            <div
              key={minute}
              className="absolute top-3 h-1.5 w-px bg-edge"
              style={{ insetInlineStart: `${String((minute / RULER_MINUTES) * 100)}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between pt-2 text-sm text-ink-3 tabular-nums">
          <bdi>{t("tap")}</bdi>
          <bdi>{t("minutes", { count: String(RULER_MINUTES / 2) })}</bdi>
          <bdi>{t("minutes", { count: String(RULER_MINUTES) })}</bdi>
        </div>
      </div>
    </div>
  );
}

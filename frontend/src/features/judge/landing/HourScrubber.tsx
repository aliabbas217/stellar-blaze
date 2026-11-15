"use client";

import { useTranslations } from "next-intl";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { TimeSpine, type BanState } from "@/components/spine/TimeSpine";
import { hourLabel } from "./field-data";

/*
 * The hour scrubber: the day as a time spine of the station's own forecast, with a slider laid over it. The slider is a
 * `role="slider"` (arrow keys, Home and End, drag) whose value is DOM text ("14:00 ..."), and a Play button. Not interactive
 * (`interactive={false}`) it is the poster the server draws before the island loads: the same spine at the same size, no
 * slider and no button, so nothing moves when the island takes over (CLS 0).
 */

export interface HourScrubberProps {
  /** The station's 24 hourly forecasts for the day: the colours of the spine. */
  readonly values: readonly number[];
  readonly ban: BanState;
  /** The hour of the now line (fractional while the day plays). */
  readonly position: number;
  /** The whole hour the text states. */
  readonly hour: number;
  readonly dir: "ltr" | "rtl";
  readonly dayLabel: string;
  /** The text value of the slider: hour, hottest point, station. */
  readonly valueText: string;
  readonly interactive: boolean;
  readonly playing: boolean;
  /** Reduced motion: no Play button, the slider is the control. */
  readonly calm: boolean;
  readonly onSeek?: (hour: number) => void;
  readonly onToggle?: () => void;
}

export function HourScrubber({ values, ban, position, hour, dir, dayLabel, valueText, interactive, playing, calm, onSeek, onToggle }: HourScrubberProps) {
  const t = useTranslations("judge.landing.field.scrubber");
  const track = useRef<HTMLDivElement>(null);
  const rtl = dir === "rtl";

  function hourAt(clientX: number): number {
    const box = track.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return hour;
    const fraction = Math.min(0.999, Math.max(0, (clientX - box.left) / box.width));
    return Math.floor((rtl ? 1 - fraction : fraction) * 24);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeek?.(hourAt(event.clientX));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (event.buttons !== 0 && event.currentTarget.hasPointerCapture(event.pointerId)) onSeek?.(hourAt(event.clientX));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const side = rtl ? -1 : 1;
    const step = { ArrowRight: side, ArrowLeft: -side, ArrowUp: 1, ArrowDown: -1 }[event.key];
    if (step !== undefined) onSeek?.((hour + step + 24) % 24);
    else if (event.key === "Home") onSeek?.(0);
    else if (event.key === "End") onSeek?.(23);
    else return;
    event.preventDefault();
  }

  const cells = values.map((wbgtC, h) => ({ hour: h, wbgtC }));
  const showPlay = !calm;

  return (
    <div
      data-scrub=""
      className="relative z-10 grid grid-cols-[var(--target)_minmax(0,1fr)] items-center gap-x-4 gap-y-1 px-4 min-[900px]:absolute min-[900px]:inset-x-10 min-[900px]:bottom-3 min-[900px]:grid-cols-[var(--target)_minmax(0,1fr)_12.5rem] min-[900px]:px-0 max-[899px]:order-3"
    >
      {showPlay ? (
        interactive ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={playing ? t("pause") : t("play")}
            className="grid size-(--target) touch-manipulation place-items-center rounded-sign border border-edge bg-ground text-ink hover:bg-panel"
          >
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <rect x="2" y="1" width="3" height="12" fill="currentColor" />
                <rect x="9" y="1" width="3" height="12" fill="currentColor" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="rtl:-scale-x-100">
                <path d="M3 1 L12 7 L3 13 Z" fill="currentColor" />
              </svg>
            )}
          </button>
        ) : (
          <span aria-hidden="true" className="size-(--target)" />
        )
      ) : (
        <span aria-hidden="true" className="size-(--target)" />
      )}
      <div className="relative min-w-0" data-spine-track="">
        <TimeSpine
          orientation="h"
          from={0}
          to={24}
          cells={cells}
          now={position}
          ban={ban}
          surface="desk"
          dir={dir}
          aria={t("label", { day: dayLabel })}
        />
        {interactive ? (
          // Laid over the band and its ticks: `inset-x-6` matches the spine's own side padding, so the slider's width is the axis.
          <div
            ref={track}
            role="slider"
            tabIndex={0}
            aria-label={t("label", { day: dayLabel })}
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={23}
            aria-valuenow={hour}
            aria-valuetext={valueText}
            data-hour-slider=""
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onKeyDown={onKeyDown}
            className="absolute inset-y-0 inset-x-6 cursor-pointer touch-pan-y rounded-sign"
          />
        ) : null}
      </div>
      <p className="text-sm text-ink-2 max-[899px]:col-span-full min-[900px]:text-end">
        <b className="block text-base font-medium text-ink tabular-nums" data-when-hour="">
          {hourLabel(hour)}
        </b>
        {t("when", { day: dayLabel })}
      </p>
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, ViewTransition } from "react";
import { Counter } from "@/components/provenance/Counter";
import type { Proof } from "@/components/provenance/proof";
import { dayFormat } from "./day-format";
import { SeasonRibbon, type SeasonRibbonProps } from "./SeasonRibbon";
import type { TallyPoint } from "./tally";
import "@/styles/view-transitions.css";
import { CLAIMS_LOCALE } from "@/i18n/claims-english";

/*
 * The season player: the hero of the scoreboard. The ribbon and the tally of days, hours and break hours reveal the
 * season day by day. Rules (journeys, the F2 plan):
 *   - it NEVER autoplays: the first paint is the final frame (the whole season and the final tally), so a reader who
 *     never presses Play still sees the finished picture, and the server HTML is the same picture;
 *   - Play runs the 139 days in 8 seconds; Pause stops where it is; Resume continues;
 *   - with reduced motion, Play does not animate: it lands on the final frame and says so.
 * The one client island on the page that moves; everything else on the scoreboard is server-rendered.
 */

/** How long the full season takes to play, in milliseconds. */
export const PLAY_MS = 8000;

export interface SeasonPlayerProps {
  readonly ribbon: Omit<SeasonRibbonProps, "upto">;
  /** Entry `i` is the running tally through day `i` (`cumulativeTally`). */
  readonly tally: readonly TallyPoint[];
  /** One proof per counter: the recorded forecast file, never a scored result. Null shows the missing-provenance note. */
  readonly proofs: { readonly days: Proof | null; readonly hours: Proof | null; readonly inBan: Proof | null };
  readonly limitC: number;
}

const noSubscription = (): (() => void) => () => undefined;

export function SeasonPlayer({ ribbon, tally, proofs, limitC }: SeasonPlayerProps) {
  const t = useTranslations("judge.scoreboard");
  const locale = CLAIMS_LOCALE;
  // False in the server HTML and until the island has hydrated, true after: a click before React is attached does nothing,
  // so the button says whether it is live (the e2e waits for it).
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const n = ribbon.days.length;
  const [upto, setUpto] = useState(n - 1);
  const [playing, setPlaying] = useState(false);
  const [calm, setCalm] = useState(false);
  const frame = useRef(0);
  // The position the running animation is at, in days (fractional), so Pause and Resume continue from it.
  const position = useRef(n - 1);

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    setPlaying(false);
  }, []);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  const onPlay = useCallback(() => {
    if (playing) {
      stop();
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      position.current = n - 1;
      setUpto(n - 1);
      setCalm(true);
      return;
    }
    setCalm(false);
    // Play from the start when the season is complete; otherwise resume where Pause left it.
    if (position.current >= n - 1) position.current = 0;
    setPlaying(true);
    let last = performance.now();
    const step = (now: number) => {
      // A frame is stamped when the browser STARTED it, which can be earlier than the `performance.now()` read at the click:
      // a negative step would take the position below day 0 (`days[-1]` is undefined, the date label throws). Time never runs back.
      position.current = Math.min(n - 1, position.current + (Math.max(0, now - last) / PLAY_MS) * n);
      last = Math.max(last, now);
      setUpto(Math.floor(position.current));
      if (position.current < n - 1) frame.current = requestAnimationFrame(step);
      else setPlaying(false);
    };
    frame.current = requestAnimationFrame(step);
  }, [n, playing, stop]);

  const format = useMemo(
    () => ({
      count: new Intl.NumberFormat(`${locale}-u-nu-latn`),
      day: dayFormat(locale),
    }),
    [locale],
  );

  const point = tally[upto] ?? tally[n - 1];
  const final = upto >= n - 1;
  const dateLabel = format.day.withWeekday(ribbon.days[upto] ?? "");
  const label = playing ? t("player.pause") : final ? t("player.play") : t("player.resume");

  return (
    <section aria-labelledby="season-heading" data-hero="" className="flex flex-col gap-4">
      <h2 id="season-heading" className="sr-only">
        {t("season.heading")}
      </h2>
      <div className="grid items-end gap-x-8 gap-y-4 min-[900px]:grid-cols-[minmax(0,1fr)_16rem]">
        <ViewTransition name="spine" share="morph" default="none">
          <div data-spine="" className="min-w-0">
            <SeasonRibbon {...ribbon} upto={upto} />
          </div>
        </ViewTransition>
        <div
          data-tally=""
          // A running count read aloud eight seconds long is noise: announce only when the animation is at rest.
          aria-live={playing ? "off" : "polite"}
          className="grid grid-cols-3 gap-3 min-[900px]:grid-cols-1 min-[900px]:gap-5 min-[900px]:pb-24"
        >
          <p className="col-span-full text-sm font-medium text-ink">
            {final ? t("tally.final", { date: dateLabel }) : t("tally.through", { date: dateLabel })}
          </p>
          <div className="border-t border-edge pt-2" data-tally-item="days">
            <Counter
              size="numeral"
              proof={proofs.days}
              value={format.count.format(point?.days ?? 0)}
              unit={t("tally.days", { limit: String(limitC) })}
              interval={t("tally.daysOf", { total: format.count.format(upto + 1) })}
            />
          </div>
          <div className="border-t border-edge pt-2" data-tally-item="hours">
            <Counter size="numeral" proof={proofs.hours} value={format.count.format(point?.hours ?? 0)} unit={t("tally.hours")} />
          </div>
          <div className="border-t border-edge pt-2" data-tally-item="inBan">
            <Counter size="numeral" proof={proofs.inBan} value={format.count.format(point?.inBan ?? 0)} unit={t("tally.inBreak")} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          data-primary=""
          data-hydrated={hydrated}
          onClick={onPlay}
          className="inline-flex min-h-(--target) items-center justify-center rounded-sign bg-ink px-5 text-base font-medium text-ground hover:underline hover:decoration-2 hover:underline-offset-4"
        >
          {label}
        </button>
        <p className="max-w-(--measure) text-sm text-ink-3" role="status">
          {calm ? t("player.reducedMotion") : t("player.note", { days: String(n) })}
        </p>
      </div>
    </section>
  );
}

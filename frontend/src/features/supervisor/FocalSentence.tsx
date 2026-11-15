"use client";

import { useTranslations } from "next-intl";
import { useCallback, type ReactNode } from "react";
import { LevelMark } from "@/components/level/LevelSign";
import type { CrewStripModel } from "@/features/supervisor/crew-model";
import { useTimeFormat } from "@/lib/time/use-time-format";

/*
 * The one sentence the screen leads with (F2 Task 19): which crew needs the supervisor first, at which level, until when and,
 * from the crew's own plan, its work and rest minutes, and how long to the midday break. A message with slots: no part of the
 * sentence is built from words in code. Which variant is said depends on what is known, never on a guess: no plan yet means no
 * cycle in the sentence, no break ahead means no break clause.
 */

const bdi = (chunks: ReactNode): ReactNode => <bdi>{chunks}</bdi>;

/** "1 h 20 min", "3 h", "45 min": a span of minutes, Western digits. */
export function useDurationLabel(): (minutes: number) => string {
  const t = useTranslations("supervisor.crews.duration");
  return useCallback(
    (minutes: number) => {
      const total = Math.max(0, Math.round(minutes));
      const hours = Math.floor(total / 60);
      const rest = total % 60;
      if (hours === 0) return t("minutes", { minutes: String(rest) });
      return rest === 0 ? t("hours", { hours: String(hours) }) : t("hoursMinutes", { hours: String(hours), minutes: String(rest) });
    },
    [t],
  );
}

export function FocalSentence({
  focal,
  breakInMinutes,
  kicker,
}: {
  readonly focal: CrewStripModel;
  readonly breakInMinutes: number | null;
  /** The line above the sentence; the crews screen's own ("Needs you first", or "Highest level, off shift now" for a crew that is not on shift) unless the plan screen says what the sentence is. */
  readonly kicker?: string;
}) {
  const t = useTranslations("supervisor.crews");
  const levels = useTranslations("levels");
  const time = useTimeFormat();
  const duration = useDurationLabel();
  const crew = focal.crew.name;
  const level = focal.level === null ? null : levels(`name.${focal.level}`);

  let sentence: ReactNode;
  if (focal.stopped && focal.stoppedAt !== null) {
    sentence = t.rich("focal.stopped", { crew, time: time(new Date(focal.stoppedAt)), bdi });
  } else if (level === null) {
    sentence = t.rich("focal.noLevel", { crew, bdi });
  } else if (focal.working && focal.until !== null) {
    const until = time(new Date(focal.until));
    const cycle =
      focal.cycle === null ? null : t("focal.cycle", { work: String(focal.cycle.workMinutes), rest: String(focal.cycle.restMinutes) });
    const breakIn = breakInMinutes === null ? null : duration(breakInMinutes);
    if (cycle !== null && breakIn !== null) sentence = t.rich("focal.workingCycleBreak", { crew, level, until, cycle, breakIn, bdi });
    else if (cycle !== null) sentence = t.rich("focal.workingCycle", { crew, level, until, cycle, bdi });
    else if (breakIn !== null) sentence = t.rich("focal.workingBreak", { crew, level, until, breakIn, bdi });
    else sentence = t.rich("focal.working", { crew, level, until, bdi });
  } else if (focal.startsAt !== null) {
    sentence = t.rich("focal.off", { crew, level, start: time(new Date(focal.startsAt)), bdi });
  } else {
    sentence = t.rich("focal.offNoStart", { crew, bdi });
  }

  return (
    <section aria-labelledby="focal" className="flex flex-col gap-2 px-4 pt-3">
      <p className="flex items-center gap-2 text-base text-ink-2">
        {focal.level === null ? null : <LevelMark level={focal.level} />}
        {kicker ?? (focal.working || focal.stopped ? t("kicker") : t("kickerOff"))}
      </p>
      <h2 id="focal" className="font-display text-xl font-medium leading-(--sign-leading-text) text-ink">
        {sentence}
      </h2>
    </section>
  );
}

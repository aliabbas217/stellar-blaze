"use client";

import { useLocale, useTranslations } from "next-intl";
import { ViewTransition, type CSSProperties, type ReactNode } from "react";
import { LevelMark } from "@/components/level/LevelSign";
import { levelIndex, type Level } from "@/components/level/level";
import { FieldLink } from "@/components/shell/FieldLink";
import { formatClock, pct, percentAt, screenPercent, tickHours } from "@/components/spine/geometry";
import { QaylulaOutline, QaylulaSlot } from "@/components/spine/QaylulaSlot";
import { SlotLabel } from "@/components/spine/SpineLabels";
import type { BanState } from "@/components/spine/ban-state";
import type { CrewCell, CrewStripModel } from "@/features/supervisor/crew-model";
import { dirFor } from "@/i18n/direction";
import { heatColor } from "@/lib/heat/ramp";
import { useTimeFormat } from "@/lib/time/use-time-format";
import "@/styles/view-transitions.css";

/*
 * The hero of the crews screen (F2 Task 19): one row per crew across the day, worst first. Bar height is the crew's level,
 * colour is the heat of the hour (from a fresh forecast only; otherwise the hair colour, never a level colour), one midday
 * slot cut through every row where the break is in force (a dashed, labelled outline where it is not), and one now line.
 * Each row is a link to the crew's plan.
 *
 * Why not one `TimeSpine` per crew: a spine carries its own tick row, slot label and padding, so four crews would draw the
 * ticks four times and break the slot and the now line into four pieces. This draws the same primitives (the slot, its
 * label, the ticks' hours, the heat ramp, the percentage geometry) once, across all rows. The rows' bars are SVG on the
 * percentage coordinates of the track; every label is HTML text at 16 px or more, so a screen reader reads the rows and a
 * long name wraps instead of clipping.
 */

/** The label column: wide enough for "Orange until 17:00" at 16 px, narrow enough to leave 12 hours a track. */
const LABEL_COLUMN = "8.5rem";

type Custom = CSSProperties & Record<`--${string}`, string>;

const bdi = (chunks: ReactNode): ReactNode => <bdi>{chunks}</bdi>;

interface RunText {
  readonly level: Level;
  readonly from: number;
  readonly to: number;
}

/** The shift hours as runs of one level: "Orange 06:00 to 11:00": the table alternative of the bars, for a screen reader. */
function runsOf(cells: readonly CrewCell[]): RunText[] {
  const runs: RunText[] = [];
  for (const cell of cells) {
    if (!cell.onShift || cell.level === null) continue;
    const last = runs.at(-1);
    if (last !== undefined && last.level === cell.level && last.to === cell.hour) runs[runs.length - 1] = { ...last, to: cell.hour + 1 };
    else runs.push({ level: cell.level, from: cell.hour, to: cell.hour + 1 });
  }
  return runs;
}

function Bars({
  cells,
  from,
  to,
  dir,
  heat,
}: {
  readonly cells: readonly CrewCell[];
  readonly from: number;
  readonly to: number;
  readonly dir: "ltr" | "rtl";
  readonly heat: ReadonlyMap<number, number>;
}) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false" className="block size-full">
      <line x1="0" x2="100" y1="100" y2="100" vectorEffect="non-scaling-stroke" className="stroke-hair stroke-1" />
      {cells.map((cell) => {
        if (!cell.onShift || cell.level === null) return null;
        const a = screenPercent(percentAt(cell.hour, from, to), "h", dir);
        const b = screenPercent(percentAt(cell.hour + 1, from, to), "h", dir);
        const height = levelIndex(cell.level) * 25;
        const wbgt = heat.get(cell.hour);
        const style: Custom | undefined =
          wbgt === undefined ? undefined : { "--heat-night": heatColor(wbgt, "night"), "--heat-sun": heatColor(wbgt, "sun") };
        return (
          <rect
            key={cell.hour}
            data-cell={cell.hour}
            data-heat={wbgt === undefined ? "none" : "data"}
            x={pct(Math.min(a, b))}
            width={pct(Math.abs(b - a))}
            y={pct(100 - height)}
            height={pct(height)}
            vectorEffect="non-scaling-stroke"
            className={`stroke-1 stroke-ground in-data-[theme=sun]:stroke-edge ${
              wbgt === undefined ? "fill-hair" : "fill-(--heat-night) in-data-[theme=sun]:fill-(--heat-sun)"
            }`}
            style={style}
          />
        );
      })}
    </svg>
  );
}

function Row({
  model,
  from,
  to,
  dir,
  heat,
}: {
  readonly model: CrewStripModel;
  readonly from: number;
  readonly to: number;
  readonly dir: "ltr" | "rtl";
  readonly heat: ReadonlyMap<number, number>;
}) {
  const t = useTranslations("supervisor.crews");
  const levels = useTranslations("levels");
  const time = useTimeFormat();
  const { crew, level } = model;
  const levelName = level === null ? null : levels(`name.${level}`);

  let levelLine: ReactNode = t("row.none");
  if (level !== null && levelName !== null) {
    if (model.working && model.until !== null) {
      levelLine = t.rich("row.working", { level: levelName, until: time(new Date(model.until)), bdi });
    } else if (!model.working && model.startsAt !== null) {
      levelLine = t.rich("row.off", { level: levelName, start: time(new Date(model.startsAt)), bdi });
    } else {
      levelLine = <bdi>{levelName}</bdi>;
    }
  } else if (!model.working && model.cells.length > 0 && !model.cells.some((cell) => cell.onShift)) {
    levelLine = t("row.noShift");
  }

  const runs = runsOf(model.cells);
  const runsText = runs
    .map((run) => t("row.run", { level: levels(`name.${run.level}`), from: formatClock(run.from), to: formatClock(run.to) }))
    .join("; ");
  const sub = [crew.task_label, t(`row.plan.${model.planState}`)];

  return (
    <li data-crew={crew.id} className="border-b border-hair last:border-b-0">
      <FieldLink
        href={`/supervisor/crews/${crew.id}`}
        className="grid min-h-28 items-end gap-x-3 rounded-sign py-2 text-ink no-underline hover:bg-panel focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
        style={{ gridTemplateColumns: `${LABEL_COLUMN} minmax(0, 1fr)` }}
      >
        <span className="flex min-w-0 flex-col gap-0.5 self-stretch justify-center">
          <span className="font-body text-base font-semibold leading-(--sign-leading-text)">
            <bdi className="leading-[inherit]">{crew.name}</bdi>
          </span>
          <span className="flex items-start gap-2 font-body text-base leading-(--sign-leading-text)">
            {level === null ? null : <LevelMark level={level} />}
            <span className="min-w-0">{levelLine}</span>
          </span>
          {model.stopped && model.stoppedAt !== null ? (
            <span className="font-body text-sm font-semibold leading-(--sign-leading-text)">
              {t.rich("row.stopped", { time: time(new Date(model.stoppedAt)), bdi })}
            </span>
          ) : null}
          <span className="font-body text-sm leading-(--sign-leading-text) text-ink-3">
            <bdi className="leading-[inherit]">{sub.join(" · ")}</bdi>
          </span>
        </span>
        <span className="relative h-16 self-end" data-track="">
          <Bars cells={model.cells} from={from} to={to} dir={dir} heat={heat} />
        </span>
        <span className="sr-only">
          {runsText === "" ? null : `${t("row.runs", { runs: runsText })} `}
          {t("row.openPlan")}
        </span>
      </FieldLink>
    </li>
  );
}

export interface CrewStripsProps {
  readonly crews: readonly CrewStripModel[];
  readonly from: number;
  readonly to: number;
  readonly nowHour: number | null;
  readonly ban: BanState;
  readonly heat: ReadonlyMap<number, number>;
}

export function CrewStrips({ crews, from, to, nowHour, ban, heat }: CrewStripsProps) {
  const t = useTranslations("supervisor.crews");
  const locale = useLocale();
  const dir = dirFor(locale);
  const showNow = nowHour !== null && nowHour >= from && nowHour <= to;
  const nowAt = showNow ? pct(screenPercent(percentAt(nowHour, from, to), "h", dir)) : "0";
  const slotAxis = { orientation: "h", dir, spanFrom: from, spanTo: to } as const;
  const axis = { orientation: "h", dir, from, to } as const;
  const aria =
    ban.kind === "in-force"
      ? t("strips.ariaBreak", { from: formatClock(ban.fromHour), to: formatClock(ban.toHour), now: nowHour === null ? "" : formatClock(nowHour) })
      : t("strips.aria", { now: nowHour === null ? "" : formatClock(nowHour) });
  // The overlay sits over the track column of every row: the width the rows' second grid column has, at the inline end.
  const track: CSSProperties = { width: `calc(100% - ${LABEL_COLUMN} - var(--s-3))`, insetInlineEnd: 0 };

  return (
    <ViewTransition name="spine" share="morph" default="none">
      <section data-spine="" data-hero="" data-surface="field" data-ban={ban.kind} dir={dir} aria-label={aria} className="px-4 font-body text-ink">
        <div className="grid items-end gap-x-3" style={{ gridTemplateColumns: `${LABEL_COLUMN} minmax(0, 1fr)` }}>
          <span aria-hidden="true" />
          <div className="relative flex min-h-6 flex-col gap-1 pb-2">
            {showNow ? (
              <div dir="ltr" aria-hidden="true" className="relative h-6">
                <span
                  data-now-label=""
                  style={{ left: `${nowAt}%` }}
                  className="absolute top-0 -translate-x-full pe-1 font-body text-base font-semibold leading-solid text-ink"
                >
                  {t("strips.now")}
                </span>
              </div>
            ) : null}
            <SlotLabel ban={ban} surface="desk" {...axis} />
          </div>
        </div>
        <div className="relative">
          <ol className="m-0 flex list-none flex-col p-0">
            {crews.map((model) => (
              <Row key={model.crew.id} model={model} from={from} to={to} dir={dir} heat={heat} />
            ))}
          </ol>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
            style={track}
            className="pointer-events-none absolute inset-y-0 h-full"
          >
            {ban.kind === "in-force" ? (
              <QaylulaSlot {...slotAxis} fromHour={ban.fromHour} toHour={ban.toHour} />
            ) : ban.outline !== null ? (
              <QaylulaOutline {...slotAxis} fromHour={ban.outline.fromHour} toHour={ban.outline.toHour} />
            ) : null}
            {showNow ? (
              <line data-now="" x1={nowAt} x2={nowAt} y1="0" y2="100" vectorEffect="non-scaling-stroke" className="stroke-signal stroke-2" />
            ) : null}
          </svg>
        </div>
        {/* Every 6 hours: the track is about 200 px at 390, and five 16 px times at 3 hours would touch. */}
        <div className="grid gap-x-3" style={{ gridTemplateColumns: `${LABEL_COLUMN} minmax(0, 1fr)` }}>
          <span aria-hidden="true" />
          <div dir="ltr" aria-hidden="true" className="relative h-6">
            {tickHours(from, to, true).filter((hour) => hour % 6 === 0).map((hour) => (
              <span
                key={hour}
                data-tick={hour}
                style={{ left: `${pct(screenPercent(percentAt(hour, from, to), "h", dir))}%` }}
                className="absolute top-1 -translate-x-1/2 font-body text-base font-medium leading-solid text-ink-2"
              >
                {formatClock(hour)}
              </span>
            ))}
          </div>
        </div>
        <p className="pt-2 text-sm text-ink-3">{t("strips.legend")}</p>
      </section>
    </ViewTransition>
  );
}

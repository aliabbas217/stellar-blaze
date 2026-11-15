import type { BanState } from "@/components/spine/ban-state";

/*
 * A day plan drawn on the hours: the work runs as bars, the heat of each hour behind them (colours handed in by the caller:
 * heat colour appears on data only), the midday break cut through below the ground as the recessed slot when it is in force
 * (a dashed, labelled outline when it is not), and violations numbered on the bars they attach to.
 *
 * Presentational and shared (the try-a-plan strip uses it now, the supervisor's plan view reuses it): it takes minutes and
 * words as props and imports no feature. Times are site-local minutes since midnight. Same construction as the day chart:
 * positions are percentages of the axis, text is DOM, so nothing is stretched and Urdu or Arabic labels wrap rather than clip.
 */

export interface PlanBar {
  readonly fromMin: number;
  readonly toMin: number;
}

export interface PlanMark {
  /** The number shown on the bar and in the list beside the chart. */
  readonly n: number;
  readonly fromMin: number;
  readonly toMin: number;
}

export interface PlanBarsLabels {
  readonly ariaLabel: string;
  /** In-force slot: "Midday break". */
  readonly slot: string;
  /** Not in force: "Midday break by law: not in force until 15 Jun". */
  readonly outline: string;
}

export interface PlanBarsProps {
  readonly bars: readonly PlanBar[];
  readonly marks?: readonly PlanMark[];
  /** One CSS colour per local hour 0 to 23, or null where the hour has no forecast. */
  readonly heat: readonly (string | null)[];
  readonly ban: BanState;
  /** First and last local hour on the axis. */
  readonly fromHour: number;
  readonly toHour: number;
  readonly labels: PlanBarsLabels;
}

const hourLabel = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

export function PlanBars({ bars, marks = [], heat, ban, fromHour, toHour, labels }: PlanBarsProps) {
  const span = (toHour - fromHour) * 60;
  const at = (minutes: number): number => Math.min(100, Math.max(0, ((minutes - fromHour * 60) / span) * 100));
  const hours = Array.from({ length: toHour - fromHour }, (_, i) => fromHour + i);
  const slot = ban.kind === "in-force" ? ban : null;
  const outline = ban.kind === "not-in-force" ? ban.outline : null;
  const box = slot ?? outline;

  return (
    <div role="img" aria-label={labels.ariaLabel} dir="ltr" className="flex w-full flex-col gap-1 text-ink" data-plan-bars="">
      <div className="relative h-32 w-full sm:h-40">
        <div aria-hidden className="absolute inset-x-0 top-0 flex h-12 overflow-hidden sm:h-16 rounded-sign border border-hair" data-plan-heat="">
          {hours.map((hour) => (
            <span key={hour} className="h-full flex-1" style={{ backgroundColor: heat[hour] ?? "transparent" }} />
          ))}
        </div>
        {bars.map((bar, i) => (
          <span
            key={`${String(bar.fromMin)}-${String(bar.toMin)}-${String(i)}`}
            data-plan-bar=""
            className="absolute top-16 h-8 rounded-sign bg-ink sm:top-20"
            style={{ left: `${String(at(bar.fromMin))}%`, width: `${String(at(bar.toMin) - at(bar.fromMin))}%` }}
          />
        ))}
        {marks.map((mark, index) => {
          // Violations that attach to the same stretch of work would sit on top of each other: they are fanned out side by side.
          const same = marks.filter((other) => other.fromMin === mark.fromMin && other.toMin === mark.toMin);
          const spread = (same.indexOf(mark) - (same.length - 1) / 2) * 28;
          return (
          <span
            key={`${String(mark.n)}-${String(index)}`}
            data-violation-mark={mark.n}
            aria-hidden
            className="absolute top-13 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border-2 border-signal bg-ground text-sm font-semibold tabular-nums text-ink sm:top-17"
            style={{ left: `calc(${String(at((mark.fromMin + mark.toMin) / 2))}% + ${String(spread)}px)` }}
          >
            {mark.n}
          </span>
          );
        })}
        {box === null ? null : (
          <div className="absolute inset-x-0 bottom-0 h-6">
            <div
              data-slot={slot === null ? "outline" : "in-force"}
              className={`absolute inset-y-0 flex items-center justify-center overflow-hidden px-1 text-xs text-ink-2 ${
                slot === null ? "border border-dashed border-edge" : "border-x border-edge bg-slot"
              }`}
              style={{ left: `${String(at(box.fromHour * 60))}%`, width: `${String(at(box.toHour * 60) - at(box.fromHour * 60))}%` }}
            >
              <span className="truncate">{slot === null ? labels.outline : labels.slot}</span>
            </div>
          </div>
        )}
      </div>
      <div aria-hidden className="relative h-5 text-xs text-ink-3">
        {hours.map((hour, i) => (
          <span
            key={hour}
            className={`absolute top-0 -translate-x-1/2 whitespace-nowrap tabular-nums ${i % 3 === 0 ? "" : "max-sm:hidden"} ${i % 2 === 0 ? "" : "sm:hidden"}`}
            style={{ left: `${String(at(hour * 60))}%` }}
          >
            {hourLabel(hour)}
          </span>
        ))}
      </div>
    </div>
  );
}

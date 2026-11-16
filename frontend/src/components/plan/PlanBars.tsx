import type { BanState } from "@/components/spine/ban-state";

/*
 * A day plan drawn on the hours: the work runs as bars, the heat of each hour behind them (colours handed in by the caller:
 * heat colour appears on data only), the midday break cut through below the ground as the recessed slot when it is in force
 * (a dashed, labelled outline when it is not), and violations numbered on the bars they attach to.
 *
 * Presentational and shared (the try-a-plan strip and the supervisor's plan view): it takes minutes and words as props and
 * imports no feature. Times are site-local minutes since midnight. Same construction as the day chart: positions are
 * percentages of the axis, text is DOM, so nothing is stretched and Urdu or Arabic labels wrap rather than clip.
 *
 * Two ways to hand in the plan. `bars` is the try-a-plan strip's: every run is work. `blocks` is the supervisor's: each run has
 * a state (work, adosh_rest, art18_break, ban, stopped, off), drawn so that no state is told by colour alone (a solid bar, a
 * hollow bar, a double-framed bar, a dashed bar); `ban` and `off` are not drawn as bars (the slot is the ban; off is absence).
 * `nowMin` draws the now line through the chart; `slotThrough` cuts the slot through the whole chart instead of its foot;
 * `field` sets the hour labels at 16 px (a phone surface), every three hours on a day of nine hours or more and every two on a
 * shorter one, so the 16 px labels never touch.
 */

export interface PlanBar {
  readonly fromMin: number;
  readonly toMin: number;
}

/** What a crew does in a stretch of the day: the contract's `PlanState` wire values. */
export type PlanBlockState = "work" | "adosh_rest" | "art18_break" | "ban" | "stopped" | "off";

export interface PlanBlockBar extends PlanBar {
  readonly state: PlanBlockState;
}

export interface PlanMark {
  /** The number shown on the bar and in the list beside the chart. */
  readonly n: number;
  readonly fromMin: number;
  readonly toMin: number;
}

/** The heat of one hour: one colour, or a colour per theme (the page's theme decides which paints). */
export type HeatCell = string | { readonly night: string; readonly sun: string };

export interface PlanBarsLabels {
  readonly ariaLabel: string;
  /** In-force slot: "Midday break". */
  readonly slot: string;
  /** Not in force: "Midday break by law: not in force until 15 Jun". */
  readonly outline: string;
}

export interface PlanBarsProps {
  readonly bars?: readonly PlanBar[];
  readonly blocks?: readonly PlanBlockBar[];
  readonly marks?: readonly PlanMark[];
  /** One heat per local hour 0 to 23, or null where the hour has no forecast. */
  readonly heat: readonly (HeatCell | null)[];
  readonly ban: BanState;
  /** First and last local hour on the axis. */
  readonly fromHour: number;
  readonly toHour: number;
  readonly labels: PlanBarsLabels;
  /** Now, as site-local minutes since midnight; null or outside the axis: no line. */
  readonly nowMin?: number | null;
  readonly slotThrough?: boolean;
  readonly field?: boolean;
}

/**
 * How each state looks, as class lists (full names, so Tailwind finds them). Shared by the chart, the legend and the block rows
 * so the three always agree: the swatch is the bar in small.
 */
export const PLAN_STATE_CLASS: Readonly<Record<PlanBlockState, string>> = {
  work: "bg-ink",
  adosh_rest: "border-2 border-ink bg-ground",
  art18_break: "border-4 border-double border-ink bg-panel",
  ban: "border border-edge bg-slot",
  stopped: "border-2 border-dashed border-ink bg-ground",
  off: "border border-hair bg-transparent",
};

/** The state's mark in small (legend and block rows). Decorative: the state's name is always beside it. */
export function PlanSwatch({ state }: { readonly state: PlanBlockState }) {
  return <span aria-hidden="true" data-plan-swatch={state} className={`inline-block h-3 w-5 shrink-0 rounded-sign ${PLAN_STATE_CLASS[state]}`} />;
}

const hourLabel = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

function heatStyle(cell: HeatCell | null): { style?: Record<string, string>; className: string } {
  if (cell === null) return { className: "" };
  if (typeof cell === "string") return { className: "", style: { backgroundColor: cell } };
  return { className: "bg-(--heat-night) in-data-[theme=sun]:bg-(--heat-sun)", style: { "--heat-night": cell.night, "--heat-sun": cell.sun } };
}

export function PlanBars({ bars = [], blocks = [], marks = [], heat, ban, fromHour, toHour, labels, nowMin = null, slotThrough = false, field = false }: PlanBarsProps) {
  const span = (toHour - fromHour) * 60;
  const at = (minutes: number): number => Math.min(100, Math.max(0, ((minutes - fromHour * 60) / span) * 100));
  const hours = Array.from({ length: toHour - fromHour }, (_, i) => fromHour + i);
  const slot = ban.kind === "in-force" ? ban : null;
  const outline = ban.kind === "not-in-force" ? ban.outline : null;
  const box = slot ?? outline;
  const drawn = blocks.filter((block) => block.state !== "ban" && block.state !== "off");
  const showNow = nowMin !== null && nowMin >= fromHour * 60 && nowMin <= toHour * 60;
  const through = slotThrough && slot !== null;

  return (
    <div className="flex w-full flex-col gap-1">
      <div role="img" aria-label={labels.ariaLabel} dir="ltr" className="flex w-full flex-col gap-1 text-ink" data-plan-bars="">
        <div className="relative h-32 w-full sm:h-40">
          <div aria-hidden className="absolute inset-x-0 top-0 flex h-12 overflow-hidden sm:h-16 rounded-sign border border-hair" data-plan-heat="">
            {hours.map((hour) => {
              const cell = heatStyle(heat[hour] ?? null);
              return <span key={hour} className={`h-full flex-1 ${cell.className}`} style={cell.style} />;
            })}
          </div>
          {bars.map((bar, i) => (
            <span
              key={`${String(bar.fromMin)}-${String(bar.toMin)}-${String(i)}`}
              data-plan-bar=""
              className="absolute top-16 h-8 rounded-sign bg-ink sm:top-20"
              style={{ left: `${String(at(bar.fromMin))}%`, width: `${String(at(bar.toMin) - at(bar.fromMin))}%` }}
            />
          ))}
          {drawn.map((block, i) => (
            <span
              key={`${block.state}-${String(block.fromMin)}-${String(i)}`}
              data-plan-bar=""
              data-plan-block={block.state}
              className={`absolute top-16 box-border h-8 min-w-0.5 rounded-sign sm:top-20 ${PLAN_STATE_CLASS[block.state]}`}
              style={{ left: `${String(at(block.fromMin))}%`, width: `${String(at(block.toMin) - at(block.fromMin))}%` }}
            />
          ))}
          {marks.map((mark, index) => {
            // Violations that attach to the same stretch of work would sit on top of each other: they are fanned out side by side.
            const same = marks.filter((other) => other.fromMin === mark.fromMin && other.toMin === mark.toMin);
            const spread = (same.indexOf(mark) - (same.length - 1) / 2) * 28;
            return (
            // fixed-height-ok: a numbered circle holding one Western digit (aria-hidden, the violation list below carries the words); the digit cannot grow in any script
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
            <div className={`absolute inset-x-0 bottom-0 ${through ? "top-0" : "h-8"}`}>
              <div
                data-slot={slot === null ? "outline" : "in-force"}
                className={`absolute inset-y-0 flex ${through ? "items-end pb-1" : "items-center"} justify-center overflow-hidden px-1 text-xs text-ink-2 ${
                  slot === null ? "border border-dashed border-edge" : "border-x border-edge bg-slot"
                } ${field ? "text-sm" : ""}`}
                style={{ left: `${String(at(box.fromHour * 60))}%`, width: `${String(at(box.toHour * 60) - at(box.fromHour * 60))}%` }}
              >
                {slot === null ? null : <span className="text-center leading-tight">{labels.slot}</span>}
              </div>
            </div>
          )}
          {showNow ? (
            <span
              aria-hidden
              data-now=""
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-signal"
              style={{ left: `${String(at(nowMin))}%` }}
            />
          ) : null}
        </div>
        <div aria-hidden className={`relative ${field ? "h-6" : "h-5"} ${field ? "text-base" : "text-xs"} text-ink-3`}>
          {(field ? [...hours, toHour] : hours).map((hour, i, all) => {
            // A phone: the first label flush with the axis start and the last with its end, so none overflows the page.
            const edge = i === 0 ? "start" : field && i === all.length - 1 ? "end" : "middle";
            const step = toHour - fromHour >= 9 ? 3 : 2;
            const shown = field ? (hour - fromHour) % step === 0 : true;
            if (!shown) return null;
            return (
              <span
                key={hour}
                {...(field ? { "data-time-label": "" } : {})}
                className={`absolute top-0 whitespace-nowrap tabular-nums ${
                  edge === "start" ? "" : edge === "end" ? "-translate-x-full" : "-translate-x-1/2"
                } ${field ? "" : `${i % 3 === 0 ? "" : "max-sm:hidden"} ${i % 2 === 0 ? "" : "sm:hidden"}`}`}
                style={{ left: `${String(at(hour * 60))}%` }}
              >
                {hourLabel(hour)}
              </span>
            );
          })}
        </div>
      </div>
      {/* The break is not in force on this day: its dashed outline is named in words below the chart (a band this narrow cannot hold the sentence). */}
      {slot === null && outline !== null ? (
        <p className="text-sm text-ink-2" data-slot-label="outline">
          {labels.outline}
        </p>
      ) : null}
    </div>
  );
}

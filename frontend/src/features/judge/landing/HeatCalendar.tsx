import { heatColor } from "@/lib/heat/ramp";

/*
 * The heat calendar of chapter 1: every working hour of the season as one cell, days across and the hours of the working day
 * down, coloured by the recorded raw forecast where it is above the heavy-work limit and left grey where it is not. The midday
 * break is cut in below the line (the recessed slot) for exactly the days it is in force. It is the problem in one picture:
 * the break covers a band, and the hot hours are not a band.
 *
 * Server-rendered SVG, no script. Cells of one colour are one path (1,807 cells would otherwise be 1,807 elements), and the
 * colour is the night ramp at a quarter degree, finer than the eye can tell. The text (hour and month labels) is DOM. The chart
 * is `role="img"`; its table alternative is the caller's (a month table in a `details`).
 *
 * Every string and number arrives through props: this component knows no language and no date.
 */

export interface CalendarTick {
  readonly index: number;
  readonly label: string;
  /** Hidden below 640 px. */
  readonly minor?: boolean;
}

export interface HeatCalendarProps {
  /** One row per day; `rows[day][hour]` is the recorded raw forecast WBGT at that local hour, or null. */
  readonly rows: readonly (readonly (number | null)[])[];
  /** First and last hour drawn, the second exclusive (06 to 19 is the working day). */
  readonly from: number;
  readonly to: number;
  readonly limitC: number;
  /** First and last day index the break is in force, or null: no slot. */
  readonly ban: { readonly fromIndex: number; readonly toIndex: number } | null;
  /** The break's hours as a fraction of the day, site local (12.5 to 15). */
  readonly banHours: { readonly from: number; readonly to: number };
  readonly ticks: readonly CalendarTick[];
  /** The hours labelled down the side. */
  readonly hourTicks: readonly { readonly hour: number; readonly label: string }[];
  readonly labels: { readonly aria: string; readonly slot: string };
}

const QUARTER = 4;
const GAP = 0.12;

const f = (n: number): string => String(Math.round(n * 100) / 100);

export function HeatCalendar({ rows, from, to, limitC, ban, banHours, ticks, hourTicks, labels }: HeatCalendarProps) {
  const days = rows.length;
  const hours = to - from;
  const byColour = new Map<string, string>();
  const cool: string[] = [];
  rows.forEach((row, day) => {
    for (let hour = from; hour < to; hour++) {
      const value = row[hour];
      if (value === null || value === undefined) continue;
      const cell = `M${f(day + GAP / 2)} ${f(hour - from + GAP / 2)}h${f(1 - GAP)}v${f(1 - GAP)}h${f(GAP - 1)}z`;
      if (value > limitC) {
        const colour = heatColor(Math.round(value * QUARTER) / QUARTER, "night");
        byColour.set(colour, (byColour.get(colour) ?? "") + cell);
      } else cool.push(cell);
    }
  });
  const slot =
    ban === null
      ? null
      : { x: ban.fromIndex, width: ban.toIndex - ban.fromIndex + 1, y: banHours.from - from, height: banHours.to - banHours.from };

  return (
    <figure className="relative h-72 sm:h-80" data-calendar="">
      <div className="absolute start-12 end-3 top-2 bottom-9">
        <svg
          viewBox={`0 0 ${String(days)} ${String(hours)}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={labels.aria}
          className="block size-full"
          shapeRendering="crispEdges"
        >
          <path d={cool.join("")} className="fill-raised" />
          {[...byColour].map(([colour, d]) => (
            <path key={colour} d={d} fill={colour} />
          ))}
          {slot === null ? null : (
            <g>
              <rect x={slot.x} y={slot.y} width={slot.width} height={slot.height} className="fill-slot" fillOpacity={0.9} />
              <path
                d={`M${f(slot.x)} ${f(slot.y)}h${f(slot.width)}M${f(slot.x)} ${f(slot.y + slot.height)}h${f(slot.width)}`}
                className="stroke-edge"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
        </svg>
        {slot === null ? null : (
          <span
            className="pointer-events-none absolute -translate-y-1/2 text-xs font-medium text-ink"
            style={{
              top: `${String(((slot.y + slot.height / 2) / hours) * 100)}%`,
              insetInlineStart: `${String((slot.x / days) * 100)}%`,
              width: `${String((slot.width / days) * 100)}%`,
              textAlign: "center",
            }}
          >
            {labels.slot}
          </span>
        )}
        {hourTicks.map((tick) => (
          <span
            key={tick.hour}
            className="absolute end-full -translate-y-1/2 pe-2 text-xs text-ink-3 tabular-nums"
            style={{ top: `${String(((tick.hour - from + 0.5) / hours) * 100)}%` }}
          >
            {tick.label}
          </span>
        ))}
        {ticks.map((tick) => (
          <span
            key={tick.index}
            className={`absolute top-full pt-2 text-xs whitespace-nowrap text-ink-3 ${tick.minor === true ? "max-sm:hidden" : ""} ${tick.index === 0 ? "" : tick.index === days - 1 ? "-translate-x-full rtl:translate-x-full" : "-translate-x-1/2 rtl:translate-x-1/2"}`}
            style={{ insetInlineStart: `${String(((tick.index + 0.5) / days) * 100)}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

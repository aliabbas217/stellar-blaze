import { ViewTransition, type CSSProperties, type ReactNode } from "react";
import { heatColor } from "@/lib/heat/ramp";
import "@/styles/view-transitions.css";
import type { BanState } from "./ban-state";
import { pct, percentAt, screenPercent, type Dir, type Orientation, type Surface } from "./geometry";
import { QaylulaOutline, QaylulaSlot } from "./QaylulaSlot";
import { SlotLabel, SpineTicks, SpineWaypoints, type SpineWaypoint } from "./SpineLabels";

/*
 * The time spine (DESIGN.md section 2): hour cells in heat colour, the recessed qaylula slot where the midday break is
 * in force, a --signal line at now, the clock ticks and the waypoints as text. It is a server component with no
 * client code: cells are SVG on percentage coordinates (viewBox 0 0 100 100, preserveAspectRatio none, non-scaling
 * strokes), labels are HTML on the same coordinates, the theme picks each cell's ramp in CSS, and the direction is a
 * prop (the page's, which it already has), so nothing is measured or read after hydration.
 */

export type { SpineWaypoint };
export type { BanState } from "./ban-state";

export interface SpineCell {
  readonly hour: number;
  /** Null (no forecast for the hour) is drawn in --hair, never as the bottom of the ramp. */
  readonly wbgtC: number | null;
}

export interface TimeSpineProps {
  readonly orientation: Orientation;
  /** First and last hour of the day shown, site local: 6 to 18 is a shift. */
  readonly from: number;
  readonly to: number;
  readonly cells: readonly SpineCell[];
  /** The current time as an hour of the day, or null for no now line. */
  readonly now: number | null;
  readonly ban: BanState;
  readonly waypoints?: readonly SpineWaypoint[];
  /** field: phone surfaces, labels 16 px and up. desk: judge, HSE and admin axes, labels 14 px, ticks 12 px. */
  readonly surface: Surface;
  readonly dir: Dir;
  /** What the cells show, as one sentence: the image's accessible name. */
  readonly aria: string;
  /**
   * The shared view-transition name (DESIGN.md: wordmark, spine, level). Null on every spine but the one that morphs
   * between screens: a name may be used once per page.
   */
  readonly transitionName?: string | null;
  /**
   * Draw the slot's own label ("Midday break, 12:30 to 15:00, by law") above the band (default). A screen that says the same in a line of
   * its own (Today's one plain line under the strip) turns it off, and the slot stays drawn.
   */
  readonly slotLabel?: boolean;
}

/** The name the hero spine carries from screen to screen (src/styles/view-transitions.css). */
export const SPINE_TRANSITION_NAME = "spine";

// Type and space tokens per surface. Labels are never below 16 px on a field surface or 12 px anywhere (tokens.css).
const SURFACE = {
  field: { text: "var(--t-16)", tick: "var(--t-16)", band: { v: "var(--s-16)", h: "var(--s-12)" }, overhang: "var(--s-3)" },
  desk: { text: "var(--t-14)", tick: "var(--t-12)", band: { v: "var(--s-10)", h: "var(--s-8)" }, overhang: "var(--s-2)" },
} as const;

type Custom = CSSProperties & Record<`--${string}`, string>;

function heatStyle(wbgtC: number): Custom {
  return { "--heat-night": heatColor(wbgtC, "night"), "--heat-sun": heatColor(wbgtC, "sun") };
}

function Cells({ orientation, dir, from, to, cells }: Pick<TimeSpineProps, "orientation" | "dir" | "from" | "to" | "cells">) {
  const byHour = new Map(cells.map((c) => [c.hour, c.wbgtC] as const));
  const rects: ReactNode[] = [];
  for (let hour = Math.floor(from); hour < Math.ceil(to); hour += 1) {
    const value = byHour.get(hour);
    const live = value !== undefined && value !== null && Number.isFinite(value);
    const a = screenPercent(percentAt(Math.max(hour, from), from, to), orientation, dir);
    const b = screenPercent(percentAt(Math.min(hour + 1, to), from, to), orientation, dir);
    const geometry =
      orientation === "v"
        ? { x: 0, width: 100, y: pct(Math.min(a, b)), height: pct(Math.abs(b - a)) }
        : { y: 0, height: 100, x: pct(Math.min(a, b)), width: pct(Math.abs(b - a)) };
    rects.push(
      <rect
        key={hour}
        data-cell={hour}
        data-heat={live ? "data" : "none"}
        {...geometry}
        vectorEffect="non-scaling-stroke"
        // A 1 px gap between cells in ground colour at night, a 1 px edge in sun (the light ground needs the edge).
        className={`stroke-1 stroke-ground in-data-[theme=sun]:stroke-edge ${
          live ? "fill-(--heat-night) in-data-[theme=sun]:fill-(--heat-sun)" : "fill-hair"
        }`}
        style={live ? heatStyle(value) : undefined}
      />,
    );
  }
  return <>{rects}</>;
}

export function TimeSpine({
  orientation,
  from,
  to,
  cells,
  now,
  ban,
  waypoints = [],
  surface,
  dir,
  aria,
  transitionName = SPINE_TRANSITION_NAME,
  slotLabel = true,
}: TimeSpineProps) {
  const s = SURFACE[surface];
  const vertical = orientation === "v";
  const span = to - from;
  const axis = { orientation, dir, from, to } as const;
  const slotAxis = { orientation, dir, spanFrom: from, spanTo: to } as const;
  const showNow = now !== null && now >= from && now <= to;
  const nowAt = showNow ? pct(screenPercent(percentAt(now, from, to), orientation, dir)) : "0";

  const vars: Custom = {
    "--spine-text": s.text,
    "--spine-tick": s.tick,
    "--spine-band": s.band[orientation],
    "--spine-overhang": s.overhang,
    "--spine-cross": "calc(var(--spine-band) + var(--spine-overhang) * 2)",
    // the locale's line height (globals.css), so a waypoint's rule lands on its time in Latin, Arabic and Nastaliq alike
    "--spine-leading": "var(--sign-leading-text, var(--leading-body))",
    "--spine-row": "calc(var(--spine-text) * var(--spine-leading))",
    // a vertical hour is two text rows tall, so a title and a detail line fit between neighbouring hours
    "--spine-hour": "calc(var(--spine-row) * 2)",
    "--spine-length": `calc(var(--spine-hour) * ${String(span)})`,
    "--spine-tickrow": "calc(var(--spine-tick) * 1.5)",
  };

  // the band: cells in their own layer, inset by the overhang on the cross axis, so the slot (the overlay) is wider
  const band = (
    <>
      <div className={vertical ? "absolute inset-y-0 inset-x-(--spine-overhang)" : "absolute inset-x-0 inset-y-(--spine-overhang)"}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={aria} className="block size-full">
          <Cells orientation={orientation} dir={dir} from={from} to={to} cells={cells} />
        </svg>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full">
        {ban.kind === "in-force" ? (
          <QaylulaSlot {...slotAxis} fromHour={ban.fromHour} toHour={ban.toHour} />
        ) : surface === "desk" && ban.outline !== null ? (
          <QaylulaOutline {...slotAxis} fromHour={ban.outline.fromHour} toHour={ban.outline.toHour} />
        ) : null}
        {showNow ? (
          <line
            data-now=""
            {...(vertical ? { x1: 0, x2: 100, y1: nowAt, y2: nowAt } : { y1: 0, y2: 100, x1: nowAt, x2: nowAt })}
            vectorEffect="non-scaling-stroke"
            className="stroke-signal stroke-2"
          />
        ) : null}
      </svg>
    </>
  );

  const labels = slotLabel ? <SlotLabel ban={ban} surface={surface} {...axis} /> : null;
  const waypointList = waypoints.length > 0 ? <SpineWaypoints waypoints={waypoints} {...axis} /> : null;
  const rootClass = "relative font-body text-ink text-(length:--spine-text) leading-(--spine-leading)";

  const root = vertical ? (
    <div
      data-spine=""
      data-orientation={orientation}
      data-surface={surface}
      data-ban={ban.kind}
      dir={dir}
      style={vars}
      // the last waypoint's detail line hangs below its time, so a spine with waypoints keeps one row free under the track
      className={`${rootClass} pt-3 ${waypoints.length > 0 ? "pb-(--spine-row)" : "pb-3"}`}
    >
      <div className="grid grid-cols-[5.5ch_var(--spine-cross)_minmax(0,1fr)] gap-x-3">
        <div className="relative h-(--spine-length)">
          <SpineTicks {...axis} />
        </div>
        <div className="relative h-(--spine-length)">{band}</div>
        {/* fixed-height-ok: the spine's length is its time axis (geometry); the labels inside are absolutely placed on it and the box does not clip (no overflow rule), so a taller Nastaliq label spills, never cuts */}
        <div className="relative h-(--spine-length) min-w-0">
          {waypointList}
          {labels}
        </div>
      </div>
    </div>
  ) : (
    <div
      data-spine=""
      data-orientation={orientation}
      data-surface={surface}
      data-ban={ban.kind}
      dir={dir}
      style={vars}
      className={`${rootClass} px-6 py-3`}
    >
      <div className="flex flex-col gap-2">
        {waypointList}
        {labels}
        <div className="relative h-(--spine-cross)">{band}</div>
        <div className="relative h-(--spine-tickrow)">
          <SpineTicks {...axis} coarse={surface === "field"} />
        </div>
      </div>
    </div>
  );

  return transitionName === null ? (
    root
  ) : (
    <ViewTransition name={transitionName} share="morph" default="none">
      {root}
    </ViewTransition>
  );
}

import type { SVGProps } from "react";
import type { HourRange } from "./ban-state";
import { percentAt, pct, screenPercent, type Dir, type Orientation } from "./geometry";

/*
 * The qaylula slot (DESIGN.md section 2): the midday break cut into the spine as a band one step BELOW the ground
 * (--slot), framed by two 1 px rules. It is the only shape in the system that goes below the ground. Drawn only where
 * the break is in force; where it is not, a desk surface gets the same extent as a dashed outline with no fill.
 *
 * Both are SVG groups for the spine's overlay layer (viewBox 0 0 100 100, preserveAspectRatio none, the slot spans the
 * full cross axis, which is wider than the cells by the overhang). Rules and outline use non-scaling strokes, so they
 * stay 1 px at any size.
 */

interface SlotProps extends HourRange {
  readonly orientation: Orientation;
  readonly dir: Dir;
  readonly spanFrom: number;
  readonly spanTo: number;
}

/** The rect geometry of [fromHour, toHour] on the overlay: full cross axis, the time extent along the track. */
function extent({ orientation, dir, spanFrom, spanTo, fromHour, toHour }: SlotProps): SVGProps<SVGRectElement> {
  const a = screenPercent(percentAt(fromHour, spanFrom, spanTo), orientation, dir);
  const b = screenPercent(percentAt(toHour, spanFrom, spanTo), orientation, dir);
  const start = Math.min(a, b);
  const size = Math.abs(b - a);
  return orientation === "v"
    ? { x: 0, width: 100, y: pct(start), height: pct(size) }
    : { y: 0, height: 100, x: pct(start), width: pct(size) };
}

export function QaylulaSlot(props: SlotProps) {
  const { orientation, dir, spanFrom, spanTo, fromHour, toHour } = props;
  const at = (hour: number) => screenPercent(percentAt(hour, spanFrom, spanTo), orientation, dir);
  const rule = (hour: number) =>
    orientation === "v"
      ? { x1: 0, x2: 100, y1: pct(at(hour)), y2: pct(at(hour)) }
      : { y1: 0, y2: 100, x1: pct(at(hour)), x2: pct(at(hour)) };
  return (
    <g data-slot="" data-from={String(fromHour)} data-to={String(toHour)}>
      <rect {...extent(props)} className="fill-slot" />
      {[fromHour, toHour].map((hour) => (
        <line key={hour} data-slot-rule="" {...rule(hour)} vectorEffect="non-scaling-stroke" className="stroke-edge stroke-1" />
      ))}
    </g>
  );
}

/** Where the break would be, out of season, on a desk surface: dashed, unfilled, never the slot. */
export function QaylulaOutline(props: SlotProps) {
  return (
    <g data-slot-outline="" data-from={String(props.fromHour)} data-to={String(props.toHour)}>
      <rect
        {...extent(props)}
        fill="none"
        vectorEffect="non-scaling-stroke"
        className="stroke-edge stroke-1"
        style={{ strokeDasharray: "var(--s-1) var(--s-1)" }}
      />
    </g>
  );
}

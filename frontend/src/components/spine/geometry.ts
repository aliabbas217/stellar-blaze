/*
 * The spine's geometry, as pure functions. Every position is a percentage of the spine's track (0 to 100 along time),
 * so the SVG (viewBox 0 0 100 100, preserveAspectRatio none) and the HTML labels sit on the same coordinates at any
 * size. The cross-axis sizes (band thickness, the slot's overhang) are CSS lengths from the space tokens, not units.
 */

export type Orientation = "h" | "v";
export type Dir = "ltr" | "rtl";
export type Surface = "field" | "desk";

/** The track position of time `t` (an hour of the day, fractional) on a spine that runs `from` to `to`, 0 to 100. */
export function percentAt(t: number, from: number, to: number): number {
  return ((t - from) / (to - from)) * 100;
}

/** Four decimals of a percent is a hundredth of a pixel on a 1000 px track; it keeps the markup short. */
export function pct(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Where a horizontal spine places a point on the screen: time runs inline-start to inline-end, so it mirrors in
 * right-to-left. A vertical spine runs top to bottom in both directions (its columns mirror through `dir`).
 */
export function screenPercent(p: number, orientation: Orientation, dir: Dir): number {
  return orientation === "h" && dir === "rtl" ? 100 - p : p;
}

/** `HH:MM` with Western digits, the one clock format of the app (times are never rendered in another numeral system). */
export function formatClock(hour: number): string {
  const total = Math.round(hour * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The hours that carry a clock tick: every 2 h on a spine of 14 h or less, every 3 h on a longer one. `coarse` forces
 * every 3 h, for a horizontal spine on a phone, where seven 16 px times do not fit in 340 px.
 */
export function tickHours(from: number, to: number, coarse = false): number[] {
  const step = coarse || to - from > 14 ? 3 : 2;
  const hours: number[] = [];
  for (let h = Math.ceil(from / step) * step; h <= to; h += step) hours.push(h);
  return hours;
}

/**
 * How a label placed at screen-percent `p` of the track is held inside it: centred on `p` when that leaves room on both
 * sides, otherwise aligned to the nearer end. `maxWidth` is the room the label has on that alignment, in percent of the
 * track, so a long label wraps instead of running past the edge.
 */
export function labelPlacement(p: number): { readonly shift: string; readonly maxWidth: string } {
  if (p < 25) return { shift: "0%", maxWidth: `${pct(100 - p)}%` };
  if (p > 75) return { shift: "-100%", maxWidth: `${pct(p)}%` };
  return { shift: "-50%", maxWidth: `${pct(Math.min(p, 100 - p) * 2)}%` };
}

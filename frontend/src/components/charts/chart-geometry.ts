/*
 * The shared geometry of the judge charts. Every chart draws its marks in an SVG whose viewBox is VIEW_W by VIEW_H user
 * units and which is stretched to the plot box (`preserveAspectRatio="none"`, strokes `vector-effect: non-scaling-stroke`),
 * and positions every piece of text and every small marker as DOM in percentages of the same box. So the chart is fluid
 * with no resize observer, the text is real text at the type tokens (never SVG text inside a scaled viewBox, which would
 * shrink below 12 px on a phone) and a screen reader reads the labels.
 */

export const VIEW_W = 1000;
export const VIEW_H = 400;

/** The WBGT range the season and day charts draw, degrees C (the prototype's). */
export const VMIN = 24;
export const VMAX = 40;

/** Degrees C to a y position in the viewBox (0 at the top). Values outside the range are clamped to it. */
export function yOf(value: number): number {
  const clamped = Math.min(VMAX, Math.max(VMIN, value));
  return ((VMAX - clamped) / (VMAX - VMIN)) * VIEW_H;
}

/** Degrees C to a percentage from the top of the plot box. */
export function topPct(value: number): number {
  return (yOf(value) / VIEW_H) * 100;
}

/** Index `i` of `n` points to an x position in the viewBox. A single point sits at the left edge. */
export function xOfIndex(i: number, n: number): number {
  return n <= 1 ? 0 : (i / (n - 1)) * VIEW_W;
}

/** Index `i` of `n` points to a percentage from the left of the plot box. */
export function leftPct(i: number, n: number): number {
  return (xOfIndex(i, n) / VIEW_W) * 100;
}

/** Four decimals: far below what the eye can tell apart, and keeps the path strings short. */
export function num(value: number): string {
  return String(Math.round(value * 1e4) / 1e4);
}

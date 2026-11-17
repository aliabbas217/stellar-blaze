/*
 * The heat ramps: WBGT (degrees C) to a colour, for data only (hero charts and spine cells). Heat colour never appears
 * on chrome; level marks have their own tokens (tokens.css --lv-*).
 *
 * Ported from docs/design/v2/prototype/assets/heat.js (RAMP_DARK, RAMP_LIGHT). Each ramp is a list of
 * [WBGT, L, C, h] stops with the hue UNWRAPPED (375 means 15) so interpolation never sweeps backwards through
 * green or cyan, and it interpolates in OKLCH so lightness stays monotonic: monotonic lightness is what keeps a ramp
 * readable in greyscale and for colour-vision deficiency. The prototype converted to sRGB in JavaScript; this module
 * emits the `oklch()` string instead and lets the browser convert, so the stops are the same numbers.
 * tests/unit/lib/heat/ramp.test.ts compares every value to the prototype's own ramp.
 *
 * Night ramp (inferno family, re-derived in OKLCH): low is dark, high is bright, for the dark ground.
 * Sun ramp (YlOrRd family, re-derived in OKLCH): low is pale, high is dark, for the light ground.
 */

export type HeatTheme = "night" | "sun";

/** [WBGT in degrees C, lightness, chroma, hue in degrees (unwrapped)]. */
type Stop = readonly [wbgtC: number, l: number, c: number, h: number];

export const HEAT_STOPS: Readonly<Record<HeatTheme, readonly Stop[]>> = {
  night: [
    [26, 0.24, 0.06, 285],
    [30, 0.36, 0.13, 330],
    [33, 0.5, 0.17, 375],
    [35.5, 0.64, 0.18, 398],
    [38, 0.79, 0.16, 425],
    [40.5, 0.95, 0.08, 460],
  ],
  sun: [
    [26, 0.96, 0.04, 95],
    [30, 0.88, 0.1, 80],
    [33, 0.76, 0.15, 58],
    [35.5, 0.63, 0.18, 38],
    [38, 0.5, 0.17, 25],
    [40.5, 0.36, 0.12, 20],
  ],
};

/** Four decimals is far below what the eye (or the browser's sRGB conversion) can tell apart, and keeps the strings short. */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function format(l: number, c: number, h: number): string {
  return `oklch(${String(round(l, 4))} ${String(round(c, 4))} ${String(round(h, 2))})`;
}

/**
 * The colour of `wbgtC` on the given theme's ramp, as an `oklch(L C h)` string (hue may exceed 360 on purpose). Values
 * below the first stop (26) or above the last (40.5) take the end colour, as in the prototype.
 *
 * @throws RangeError for a value that is not a finite number: a missing hour has no colour, and the caller must draw it
 * as "no data" (the spine uses `--hair`), never as the bottom of the ramp.
 */
export function heatColor(wbgtC: number, theme: HeatTheme): string {
  if (!Number.isFinite(wbgtC)) throw new RangeError(`WBGT must be a finite number, got ${String(wbgtC)}`);
  const stops = HEAT_STOPS[theme];
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined) throw new Error("heat ramp has no stops");
  if (wbgtC <= first[0]) return format(first[1], first[2], first[3]);
  for (let i = 1; i < stops.length; i += 1) {
    const [v0, l0, c0, h0] = stops[i - 1] ?? first;
    const [v1, l1, c1, h1] = stops[i] ?? last;
    if (wbgtC <= v1) {
      const t = (wbgtC - v0) / (v1 - v0);
      return format(l0 + (l1 - l0) * t, c0 + (c1 - c0) * t, h0 + (h1 - h0) * t);
    }
  }
  return format(last[1], last[2], last[3]);
}

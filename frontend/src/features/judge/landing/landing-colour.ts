import { LIMIT_C, oklchToRgb } from "./field-data";

/*
 * The colours of the landing's forecast scene, as plain numbers shared by the server (the legend and the strip of the morning slide are drawn
 * in the first HTML) and the browser (the scene's shader). The forecast is data, so it takes the heat colour: ONE sequential ramp of one hue
 * (58, amber) in four flat classes at partial opacity, so the imagery stays visible through it. Everything else is the night tokens of
 * tokens.css, written here as the OKLCH values the shader needs as numbers (tests/unit/features/judge/landing/landing-colour.test.ts keeps them
 * equal to the tokens).
 */

export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];

const HEAT_HUE = 58;
/** [lightness, chroma, opacity] of the four classes: above 26.6, 30, 33 and 36 degrees C WBGT. */
const CLASS_LCA = [
  [0.52, 0.075, 0.6],
  [0.62, 0.105, 0.66],
  [0.74, 0.125, 0.72],
  [0.88, 0.11, 0.82],
] as const;

export const GROUND: Rgb = oklchToRgb(0.145, 0.014, 245);
export const SKIRT: Rgb = oklchToRgb(0.205, 0.014, 245);
export const LINE: Rgb = oklchToRgb(0.95, 0.005, 245);
/** The brightest the grey imagery is allowed to get: a mid ground tone. */
export const IMAGERY_HI: Rgb = oklchToRgb(0.62, 0.012, 245);
export const EDGE: Rgba = [...LINE, 0.5];
export const CLASSES: readonly Rgba[] = CLASS_LCA.map(([l, c, a]): Rgba => [...oklchToRgb(l, c, HEAT_HUE), a]);

/** The class thresholds in degrees C WBGT: above the heavy-work limit, then at least 30, 33 and 36 (the shader steps at the same values). */
export const CLASS_STEPS = [LIMIT_C, 30, 33, 36] as const;

/** The class of a WBGT value: 0 below the heavy-work limit, then 1 to 4. */
export function classOf(wbgtC: number): 0 | 1 | 2 | 3 | 4 {
  return ((wbgtC > LIMIT_C ? 1 : 0) + (wbgtC >= 30 ? 1 : 0) + (wbgtC >= 33 ? 1 : 0) + (wbgtC >= 36 ? 1 : 0)) as 0 | 1 | 2 | 3 | 4;
}

export const rgbCss = (c: Rgb): string => `rgb(${c.map((x) => String(Math.round(x * 255))).join(",")})`;

/** The mid desert tone the legend swatches are blended over, as the map draws a class over its imagery. */
const SURFACE: Rgb = GROUND.map((x, i) => x + ((IMAGERY_HI[i] ?? 0) - x) * 0.55) as unknown as Rgb;

/** The colour of class `k` (1 to 4) as it looks on the map: the class blended over the desert tone. */
export function classSwatch(k: 1 | 2 | 3 | 4): string {
  const q = CLASSES[k - 1] ?? [0, 0, 0, 1];
  return rgbCss([0, 1, 2].map((i) => (SURFACE[i] ?? 0) + ((q[i] ?? 0) - (SURFACE[i] ?? 0)) * q[3]) as unknown as Rgb);
}

/** The five swatches of the legend: no class (the desert tone itself), then the four classes. */
export const LEGEND_SWATCHES: readonly string[] = [rgbCss(SURFACE), classSwatch(1), classSwatch(2), classSwatch(3), classSwatch(4)];

/** The fill of one hour of the strip under the morning slide: the same classes as the map; below the limit it is the ground. */
export function stripFill(wbgtC: number): string {
  const k = classOf(wbgtC);
  return k === 0 ? "var(--ground-deep)" : classSwatch(k);
}

/** The giant numbers of the scene captions take the amber of the ramp. */
export const HEAT_NUMBER = rgbCss(oklchToRgb(0.8, 0.15, HEAT_HUE));

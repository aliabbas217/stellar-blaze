import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { HEAT_STOPS, heatColor, type HeatTheme } from "@/lib/heat/ramp";

/*
 * The ramps are a port of the prototype's (docs/design/v2/prototype/assets/heat.js). These tests read that file, not a
 * copy of its numbers: the stops are parsed out of its source, and every colour is compared with what its own ramp
 * function returns, so a drift in either direction fails here.
 */

const PROTOTYPE = path.resolve(import.meta.dirname, "../../../../../docs/design/v2/prototype/assets/heat.js");

type Rgb = readonly [number, number, number];
interface Prototype {
  readonly RAMP_DARK: (v: number) => Rgb;
  readonly RAMP_LIGHT: (v: number) => Rgb;
  readonly oklchToRgb: (l: number, c: number, h: number) => Rgb;
}

/**
 * The prototype is a plain browser ES module outside the app's root, which the test runner cannot import. Its source is
 * evaluated instead, with `export` removed and the one `import.meta.url` (the data directory, unused here) replaced.
 */
function loadPrototype(): Prototype {
  const source = readFileSync(PROTOTYPE, "utf8")
    .replaceAll("import.meta.url", '"file:///prototype/assets/heat.js"')
    .replaceAll(/^export /gm, "");
  return runInNewContext(`${source}
({ RAMP_DARK, RAMP_LIGHT, oklchToRgb });`, { URL, Math }) as Prototype;
}

/** `oklch(0.24 0.06 285)` to [L, C, h]. */
function parse(color: string): [number, number, number] {
  const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(color);
  if (m === null) throw new Error(`not an oklch() string: ${color}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** The `[value, L, C, h]` rows of `export const <name> = makeRamp([ ... ]);` in the prototype source. */
function prototypeStops(name: string): number[][] {
  const source = readFileSync(PROTOTYPE, "utf8");
  const block = new RegExp(String.raw`export const ${name} = makeRamp\(\[([\s\S]*?)\]\);`).exec(source);
  if (block?.[1] === undefined) throw new Error(`${name} not found in ${PROTOTYPE}`);
  return [...block[1].matchAll(/\[([^\]]+)\]/g)].map((row) => (row[1] ?? "").split(",").map(Number));
}

const THEMES: readonly HeatTheme[] = ["night", "sun"];
const RANGE = Array.from({ length: 146 }, (_, i) => 26 + i * 0.1); // 26.0 to 40.5 in steps of 0.1

describe("heatColor", () => {
  // test_heat_color_lightness_is_monotonic
  it.each(THEMES)("has strictly monotonic lightness from 26 to 40.5 (%s)", (theme) => {
    const lightness = RANGE.map((v) => parse(heatColor(v, theme))[0]);
    for (let i = 1; i < lightness.length; i += 1) {
      const step = (lightness[i] ?? 0) - (lightness[i - 1] ?? 0);
      // night gets brighter with heat, sun gets darker: the direction is the ramp's, the sign never flips
      if (theme === "night") expect(step, String(RANGE[i])).toBeGreaterThan(0);
      else expect(step, String(RANGE[i])).toBeLessThan(0);
    }
  });

  it.each(THEMES)("keeps the hue unwrapped, so it never sweeps backwards (%s)", (theme) => {
    const hues = RANGE.map((v) => parse(heatColor(v, theme))[2]);
    for (let i = 1; i < hues.length; i += 1) {
      const step = (hues[i] ?? 0) - (hues[i - 1] ?? 0);
      if (theme === "night") expect(step).toBeGreaterThanOrEqual(0);
      else expect(step).toBeLessThanOrEqual(0);
    }
    // 375 is 15 degrees written past a full turn: the night ramp crosses 360 on purpose, the sun ramp never reaches it
    if (theme === "night") expect(Math.max(...hues)).toBeGreaterThan(360);
    else expect(Math.max(...hues)).toBeLessThan(360);
  });

  // test_heat_color_matches_prototype_stops
  it.each([
    ["night", "RAMP_DARK"],
    ["sun", "RAMP_LIGHT"],
  ] as const)("returns exactly the prototype's stops at the stop values (%s)", (theme, name) => {
    const stops = prototypeStops(name);
    expect(stops).toHaveLength(6); // non-vacuous: the parse found the whole ramp
    expect(HEAT_STOPS[theme].map((stop) => [...stop])).toEqual(stops);
    for (const [v, l, c, h] of stops) {
      expect(parse(heatColor(v ?? 0, theme))).toEqual([l, c, h]);
    }
  });

  it.each([
    ["night", "RAMP_DARK"],
    ["sun", "RAMP_LIGHT"],
  ] as const)("is the same colour as the prototype's ramp at every value in between (%s)", (theme, name) => {
    const proto = loadPrototype();
    for (const v of [...RANGE, 20, 45]) {
      const [l, c, h] = parse(heatColor(v, theme));
      const ours = proto.oklchToRgb(l, c, h);
      const theirs = proto[name](v);
      ours.forEach((channel, i) => {
        // 4 decimal places of L and C, 2 of h: far inside one 8-bit step (1/255 = 0.0039)
        expect(Math.abs(channel - (theirs[i] ?? 0)), `${theme} ${String(v)} channel ${String(i)}`).toBeLessThan(0.002);
      });
    }
  });

  it.each(THEMES)("clamps to the end colours outside 26 to 40.5 (%s)", (theme) => {
    expect(heatColor(10, theme)).toBe(heatColor(26, theme));
    expect(heatColor(60, theme)).toBe(heatColor(40.5, theme));
  });

  it("refuses a value that is not a number instead of colouring it as the bottom of the ramp", () => {
    expect(() => heatColor(Number.NaN, "night")).toThrow(RangeError);
    expect(() => heatColor(Number.POSITIVE_INFINITY, "sun")).toThrow(RangeError);
  });

  it("is the browser's job to convert: the output is an oklch() string, never a hex or rgb", () => {
    for (const theme of THEMES) expect(heatColor(33, theme)).toMatch(/^oklch\([\d. ]+\)$/);
  });
});

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import {
  clipCoast,
  FieldDataError,
  heatRgb,
  hottestAt,
  isothermSegments,
  makeSampler,
  parseCoast,
  parseField,
  peakHourOf,
  rasterize,
  readingAt,
  type FieldGrid,
} from "@/features/judge/landing/field-data";

const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const FIELD_FILE = path.join(ROOT, "public/data/static/uae_ifs025_d1_wbgt_2026-09-03.json");
const COAST_FILE = path.join(ROOT, "public/data/static/coast.json");
const PROTOTYPE = path.resolve(ROOT, "../docs/design/v2/prototype/assets/heat.js");

const read = (file: string): unknown => JSON.parse(readFileSync(file, "utf8")) as unknown;

/** A 3 x 3 grid, 24 hours, every cell its own number so a swapped index shows: value = 20 + 3 * row + column + hour / 100. */
function tiny(): { [key: string]: unknown; wbgt_c: (number | null)[][][] } {
  const lat = [10, 10.5, 11];
  const lon = [50, 50.5, 51];
  return {
    day_local: "2026-09-03",
    tz: "Asia/Dubai (UTC+4)",
    source: "test source",
    physics: "test physics",
    why_this_day: "test why",
    hours_local: Array.from({ length: 24 }, (_, h) => h),
    lat,
    lon,
    shape: "[lat][lon][hour]",
    wbgt_c: lat.map((_la, i) => lon.map((_lo, j) => Array.from({ length: 24 }, (_h, h) => 20 + i * 3 + j + h / 100))),
  };
}

describe("the landing field data files", () => {
  it("test_field_data_within_250kb_raw", () => {
    const bytes = statSync(FIELD_FILE).size + statSync(COAST_FILE).size;
    expect(bytes).toBeGreaterThan(100_000); // non-vacuous: both files are really counted
    expect(bytes).toBeLessThanOrEqual(250_000);
  });

  it("parses the committed field file and the committed coast file", () => {
    const grid = parseField(read(FIELD_FILE));
    expect(grid.lat).toHaveLength(17);
    expect(grid.lon).toHaveLength(22);
    expect(grid.values).toHaveLength(24 * 17 * 22);
    expect(grid.day).toBe("2026-09-03");
    expect(grid.source).toMatch(/ecmwf_ifs025/);
    expect(parseCoast(read(COAST_FILE)).length).toBeGreaterThan(10);
  });
});

describe("parseField", () => {
  it("accepts a small well-formed grid and lays the values out hour-major", () => {
    const grid = parseField(tiny());
    expect(grid.values[0]).toBeCloseTo(20, 5); // hour 0, row 0, column 0
    expect(grid.values[1]).toBeCloseTo(21, 5); // column 1
    expect(grid.values[3]).toBeCloseTo(23, 5); // row 1
    expect(grid.values[9]).toBeCloseTo(20.01, 5); // hour 1 starts after 3 x 3 cells
  });

  it.each([
    ["not an object", 7],
    ["no wbgt_c", { ...tiny(), wbgt_c: undefined }],
    ["a row of the wrong length", { ...tiny(), wbgt_c: [[[1]], [[1]], [[1]]] }],
    ["descending latitude", { ...tiny(), lat: [11, 10.5, 10] }],
    ["not 24 hours", { ...tiny(), hours_local: [0, 1] }],
    ["a missing source", { ...tiny(), source: undefined }],
  ])("throws a FieldDataError for %s", (_label, value) => {
    expect(() => parseField(value)).toThrow(FieldDataError);
  });

  it("throws for a value that is not a finite number", () => {
    const bad = tiny();
    const row = bad.wbgt_c[1]?.[1];
    if (row === undefined) throw new Error("fixture");
    row[5] = null;
    expect(() => parseField(bad)).toThrow(/finite/);
  });
});

describe("the sampler (bilinear in space, linear in time)", () => {
  const grid = parseField(tiny());
  const at = makeSampler(grid);

  it("returns the cell value on a node", () => {
    expect(at(10.5, 50.5, 0)).toBeCloseTo(24, 5);
    expect(at(11, 51, 0)).toBeCloseTo(28, 5);
    expect(at(10, 50, 0)).toBeCloseTo(20, 5);
  });

  it("interpolates between nodes and between hours", () => {
    expect(at(10.25, 50.25, 0)).toBeCloseTo(22, 5); // (20 + 21 + 23 + 24) / 4
    expect(at(10, 50, 0.5)).toBeCloseTo(20.005, 5);
  });

  it("wraps from hour 23 to hour 0 (the day is a loop)", () => {
    expect(at(10, 50, 23.5)).toBeCloseTo((20.23 + 20.0) / 2, 5);
  });

  it("clamps outside the box instead of extrapolating", () => {
    expect(at(40, 80, 0)).toBeCloseTo(28, 5);
    expect(at(-5, -5, 0)).toBeCloseTo(20, 5);
  });
});

describe("hottestAt and readingAt", () => {
  const raw = read(FIELD_FILE);
  const grid: FieldGrid = parseField(raw);

  it("hottestAt equals a brute-force scan of the raw file, every hour", () => {
    const file = raw as { lat: number[]; lon: number[]; wbgt_c: number[][][] };
    for (let h = 0; h < 24; h++) {
      let best = { value: -Infinity, lat: 0, lon: 0 };
      file.wbgt_c.forEach((row, i) => {
        row.forEach((cell, j) => {
          const v = cell[h] ?? -Infinity;
          if (v > best.value) best = { value: v, lat: file.lat[i] ?? 0, lon: file.lon[j] ?? 0 };
        });
      });
      const got = hottestAt(grid, h);
      expect(got.value).toBeCloseTo(best.value, 4);
      expect([got.lat, got.lon]).toEqual([best.lat, best.lon]);
    }
  });

  it("test_readout_text_equals_canvas_values: the hottest value of the readout is the largest value the canvas can draw", () => {
    for (let h = 0; h < 24; h++) {
      const drawn = rasterize(grid, h).values;
      let max = -Infinity;
      for (const v of drawn) max = Math.max(max, v);
      const reading = readingAt(grid, Array.from({ length: 24 }, () => 30), h);
      // the canvas samples the same grid bilinearly: it never draws hotter than the hottest cell the readout names, and it reaches it on the node
      expect(max).toBeLessThanOrEqual(reading.hottest.value + 1e-4);
      expect(max).toBeGreaterThanOrEqual(reading.hottest.value - 1e-3);
    }
  });

  it("counts the cells above the limit out of all the cells", () => {
    const reading = readingAt(grid, Array.from({ length: 24 }, () => 30), 14);
    expect(reading.cells).toBe(17 * 22);
    expect(reading.cellsAbove).toBeGreaterThan(0);
    expect(reading.cellsAbove).toBeLessThanOrEqual(reading.cells);
    // at 05:00 the whole raw forecast is above 26.6 too (a Gulf night), at the coolest hour it still is: the count must equal a brute-force count
    const file = raw as { wbgt_c: number[][][] };
    let brute = 0;
    for (const row of file.wbgt_c) for (const cell of row) if ((cell[14] ?? 0) > 26.6) brute++;
    expect(reading.cellsAbove).toBe(brute);
  });

  it("takes the station value from the series it is given", () => {
    const station = Array.from({ length: 24 }, (_, h) => 30 + h / 10);
    expect(readingAt(grid, station, 14).station).toBeCloseTo(31.4, 5);
  });

  it("peakHourOf is the hour of the station's own peak", () => {
    const series = [30.6, 30.3, 29.5, 28.4, 27.6, 27.4, 27.5, 28.7, 31.0, 33.0, 34.5, 35.4, 35.8, 36.7, 39.4, 35.9, 34.6, 33.5, 32.5, 31.4, 31.0, 30.9, 30.7, 30.4];
    expect(peakHourOf(series)).toBe(14);
  });
});

describe("coast", () => {
  it("clips rings to the box and keeps polylines of at least two points", () => {
    const coast = parseCoast({ source: "x", bbox: [0, 0, 10, 10], rings: [{ c: "AAA", r: [[-5, 5], [1, 5], [2, 5], [20, 5], [3, 6], [4, 6]] }] });
    expect(clipCoast(coast, [0, 0, 10, 10])).toEqual([
      [[1, 5], [2, 5]],
      [[3, 6], [4, 6]],
    ]);
  });

  it("rejects a ring that is not a list of lon, lat pairs", () => {
    expect(() => parseCoast({ rings: [{ c: "A", r: [[1]] }] })).toThrow(FieldDataError);
  });
});

describe("isotherms", () => {
  it("draws the 1 degree lines exactly where a linear ramp crosses an integer", () => {
    // values 25.2, 25.7, 26.2, 26.7, 27.2 along x, constant along y; the cell step is 1 node: 26 is crossed at x = 1.6 and 27 at x = 3.6
    const nx = 5;
    const nz = 3;
    const values = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) values[j * nx + i] = 25.2 + i * 0.5;
    const segments = isothermSegments(values, nx, nz, 1);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.length % 4).toBe(0);
    for (let k = 0; k < segments.length; k += 4) {
      const x1 = segments[k] ?? NaN;
      expect(x1).toBeCloseTo(segments[k + 2] ?? NaN, 4); // each line is vertical here
      expect([1.6, 3.6].some((column) => Math.abs(column - x1) < 1e-3)).toBe(true);
    }
  });

  it("returns nothing for a flat field", () => {
    expect(isothermSegments(new Float32Array(16).fill(30.5), 4, 4, 1)).toHaveLength(0);
  });

  it("finds lines on the real field at the peak hour (non-vacuous)", () => {
    const { nx, nz, values } = rasterize(parseField(read(FIELD_FILE)), 14);
    expect(isothermSegments(values, nx, nz, 2).length / 4).toBeGreaterThan(100);
  });
});

describe("the heat colour table", () => {
  it("is the prototype's RAMP_DARK at every value, to one 8-bit step", () => {
    const source = readFileSync(PROTOTYPE, "utf8").replaceAll("import.meta.url", '"file:///prototype/assets/heat.js"').replaceAll(/^export /gm, "");
    const proto = runInNewContext(`${source}\n({ RAMP_DARK });`, { URL, Math }) as { RAMP_DARK: (v: number) => [number, number, number] };
    for (let v = 18; v <= 44; v += 0.37) {
      const expected = proto.RAMP_DARK(v).map((c) => Math.round(c * 255));
      const got = heatRgb(v);
      expected.forEach((c, i) => {
        expect(Math.abs((got[i] ?? 0) - c), `${v.toFixed(2)} channel ${String(i)}`).toBeLessThanOrEqual(1);
      });
    }
  });
});
